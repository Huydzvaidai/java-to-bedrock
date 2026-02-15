const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class JavaToBedrockConverter {
  constructor() {
    this.textureWidth = 16;
    this.textureHeight = 16;
    this.spritesheetData = null;
  }

  generateSpritesheet(javaModel, modelName, outputDir) {
    const texturesDir = path.join(outputDir, 'textures_temp');
    if (!fs.existsSync(texturesDir)) {
      fs.mkdirSync(texturesDir, { recursive: true });
    }

    const texturePaths = [];
    if (javaModel.textures) {
      for (const [key, value] of Object.entries(javaModel.textures)) {
        const cleanPath = value.replace(/^[^:]+:/, '');
        const texturePath = path.join(path.dirname(outputDir), 'textures', cleanPath + '.png');
        if (fs.existsSync(texturePath)) {
          texturePaths.push(texturePath);
        }
      }
    }

    if (texturePaths.length === 0) {
      return null;
    }

    const spritesheetPath = path.join(outputDir, modelName);
    try {
      execSync(`spritesheet-js -f json --name ${spritesheetPath} --fullpath ${texturePaths.join(' ')}`, {
        stdio: 'pipe'
      });
      
      const spritesheetJsonPath = `${spritesheetPath}.json`;
      if (fs.existsSync(spritesheetJsonPath)) {
        this.spritesheetData = JSON.parse(fs.readFileSync(spritesheetJsonPath, 'utf-8'));
        return `${modelName}.png`;
      }
    } catch (error) {
      // Silently fail spritesheet generation
    }

    return null;
  }

  getTextureData(texturePath, assetsBase) {
    if (!this.spritesheetData || !this.spritesheetData.frames) {
      return null;
    }

    const cleanPath = texturePath.replace(/^[^:]+:/, '');
    const fullPath = path.join(assetsBase, 'textures', cleanPath + '.png');
    return this.spritesheetData.frames[fullPath];
  }

  calculateUV(face, textureKey, javaModel, assetsBase) {
    if (!face || !face.uv) return null;

    const texturePath = javaModel.textures[textureKey.substring(1)];
    if (!texturePath) return null;

    const textureData = this.getTextureData(texturePath, assetsBase);
    if (!textureData) {
      return {
        uv: [face.uv[0], face.uv[1]],
        uv_size: [face.uv[2] - face.uv[0], face.uv[3] - face.uv[1]]
      };
    }

    const atlasWidth = this.spritesheetData.meta.size.w;
    const atlasHeight = this.spritesheetData.meta.size.h;
    const frameX = textureData.frame.x;
    const frameY = textureData.frame.y;
    const frameW = textureData.frame.w;
    const frameH = textureData.frame.h;

    const u0 = ((face.uv[0] * frameW * 0.0625) + frameX) * (16 / atlasWidth);
    const v0 = ((face.uv[1] * frameH * 0.0625) + frameY) * (16 / atlasHeight);
    const u1 = ((face.uv[2] * frameW * 0.0625) + frameX) * (16 / atlasWidth);
    const v1 = ((face.uv[3] * frameH * 0.0625) + frameY) * (16 / atlasHeight);

    const xSign = Math.max(-1, Math.min(1, u1 - u0));
    const ySign = Math.max(-1, Math.min(1, v1 - v0));

    return {
      uv: [
        Math.round((u0 + (0.016 * xSign)) * 10000) / 10000,
        Math.round((v0 + (0.016 * ySign)) * 10000) / 10000
      ],
      uv_size: [
        Math.round(((u1 - u0) - (0.016 * xSign)) * 10000) / 10000,
        Math.round(((v1 - v0) - (0.016 * ySign)) * 10000) / 10000
      ]
    };
  }

  convertElement(element, javaModel, assetsBase) {
    const from = element.from;
    const to = element.to;

    const origin = [
      Math.round((from[0] - 8) * 10000) / 10000,
      Math.round(from[1] * 10000) / 10000,
      Math.round((from[2] - 8) * 10000) / 10000
    ];

    const size = [
      Math.round((to[0] - from[0]) * 10000) / 10000,
      Math.round((to[1] - from[1]) * 10000) / 10000,
      Math.round((to[2] - from[2]) * 10000) / 10000
    ];

    const cube = { origin, size };

    if (element.faces) {
      const uvMap = {};
      for (const [faceName, face] of Object.entries(element.faces)) {
        if (face && face.texture) {
          const uv = this.calculateUV(face, face.texture, javaModel, assetsBase);
          if (uv) {
            uvMap[faceName] = uv;
          }
        }
      }
      if (Object.keys(uvMap).length > 0) {
        cube.uv = uvMap;
      }
    }

    if (element.rotation) {
      cube.pivot = [
        Math.round((element.rotation.origin[0] - 8) * 10000) / 10000,
        Math.round(element.rotation.origin[1] * 10000) / 10000,
        Math.round((element.rotation.origin[2] - 8) * 10000) / 10000
      ];
      
      const angle = element.rotation.angle;
      const axis = element.rotation.axis;
      
      cube.rotation = [
        axis === 'x' ? -angle : 0,
        axis === 'y' ? -angle : 0,
        axis === 'z' ? angle : 0
      ];
    }

    return cube;
  }

  groupCubesByRotation(elements, javaModel, assetsBase) {
    const cubes = elements.map(el => this.convertElement(el, javaModel, assetsBase));
    const groups = [];
    const noPivotCubes = [];

    cubes.forEach(cube => {
      if (cube.rotation && cube.pivot) {
        const pivotKey = cube.pivot.join(',') + ':' + cube.rotation.join(',');
        let group = groups.find(g => g.key === pivotKey);
        
        if (!group) {
          group = {
            key: pivotKey,
            pivot: cube.pivot,
            rotation: cube.rotation,
            cubes: []
          };
          groups.push(group);
        }
        
        const cubeWithoutPivot = { ...cube };
        delete cubeWithoutPivot.pivot;
        delete cubeWithoutPivot.rotation;
        group.cubes.push(cubeWithoutPivot);
      } else {
        const cubeWithoutPivot = { ...cube };
        delete cubeWithoutPivot.pivot;
        delete cubeWithoutPivot.rotation;
        noPivotCubes.push(cubeWithoutPivot);
      }
    });

    return { groups, noPivotCubes };
  }

  convert(javaModel, modelName, outputDir, assetsBase) {
    if (javaModel.texture_size) {
      this.textureWidth = javaModel.texture_size[0];
      this.textureHeight = javaModel.texture_size[1];
    }

    this.generateSpritesheet(javaModel, modelName, outputDir);

    if (!javaModel.elements || javaModel.elements.length === 0) {
      throw new Error('No elements found in model');
    }

    const { groups, noPivotCubes } = this.groupCubesByRotation(javaModel.elements, javaModel, assetsBase);

    const bones = [
      {
        name: "campfire",
        pivot: [0, 8, 0],
        binding: "c.item_slot == 'head' ? 'head' : q.item_slot_to_bone_name(c.item_slot)"
      },
      {
        name: "campfire_x",
        parent: "campfire",
        pivot: [0, 8, 0]
      },
      {
        name: "campfire_y",
        parent: "campfire_x",
        pivot: [0, 8, 0]
      },
      {
        name: "campfire_z",
        parent: "campfire_y",
        pivot: [0, 8, 0],
        cubes: noPivotCubes
      }
    ];

    groups.forEach((group, index) => {
      bones.push({
        name: `rot_${index + 1}`,
        parent: "campfire_z",
        pivot: group.pivot,
        rotation: group.rotation,
        cubes: group.cubes
      });
    });

    return {
      format_version: "1.21.0",
      "minecraft:geometry": [
        {
          description: {
            identifier: `geometry.${modelName}`,
            texture_width: this.textureWidth,
            texture_height: this.textureHeight,
            visible_bounds_width: 4,
            visible_bounds_height: 4.5,
            visible_bounds_offset: [0, 0.75, 0]
          },
          bones: bones
        }
      ]
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const inputPack = args[0];
  const outputDir = args[1] || path.join(__dirname, '../output');
  
  if (!inputPack) {
    console.log('Usage: node converter.js <input_pack_dir> [output_dir]');
    console.log('');
    console.log('Converts all Java models from assets folder to Bedrock format');
    console.log('');
    console.log('Examples:');
    console.log('  node converter.js ../lunarset');
    console.log('  node converter.js ../my_pack ../output');
    process.exit(1);
  }
  
  const assetsDir = path.join(inputPack, 'assets');
  
  if (!fs.existsSync(assetsDir)) {
    console.error(`❌ Assets directory not found: ${assetsDir}`);
    process.exit(1);
  }
  
  function findModelFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        findModelFiles(filePath, fileList);
      } else if (file.endsWith('.json') && filePath.includes('/models/')) {
        fileList.push(filePath);
      }
    });
    
    return fileList;
  }
  
  console.log(`🔍 Scanning for models in ${assetsDir}...\n`);
  const modelFiles = findModelFiles(assetsDir);
  
  if (modelFiles.length === 0) {
    console.error('❌ No model files found in assets');
    process.exit(1);
  }
  
  console.log(`📦 Found ${modelFiles.length} model files\n`);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;
  const failedModels = [];
  const skippedModels = [];
  
  for (const filePath of modelFiles) {
    const relativePath = path.relative(assetsDir, filePath);
    const parts = relativePath.split(path.sep);
    const namespace = parts[0];
    const modelPath = parts.slice(2, -1).join('/');
    const fileName = path.basename(filePath, '.json');
    const modelName = `${namespace}_${modelPath ? modelPath + '_' : ''}${fileName}`.replace(/\//g, '_');
    
    try {
      console.log(`📥 [${successCount + failCount + skippedCount + 1}/${modelFiles.length}] ${namespace}/${modelPath}/${fileName}`);
      
      const javaModelJson = fs.readFileSync(filePath, 'utf-8');
      const javaModel = JSON.parse(javaModelJson);
      
      if (!javaModel.elements || javaModel.elements.length === 0) {
        console.log(`⏭️  Skipped (no elements)\n`);
        skippedCount++;
        skippedModels.push({ name: modelName, reason: 'No elements' });
        continue;
      }
      
      const namespaceOutputDir = path.join(outputDir, namespace, modelPath || '');
      if (!fs.existsSync(namespaceOutputDir)) {
        fs.mkdirSync(namespaceOutputDir, { recursive: true });
      }
      
      const assetsBase = path.join(assetsDir, namespace);
      const converter = new JavaToBedrockConverter();
      const bedrockModel = converter.convert(javaModel, modelName, namespaceOutputDir, assetsBase);
      
      const outputPath = path.join(namespaceOutputDir, `${fileName}.json`);
      fs.writeFileSync(outputPath, JSON.stringify(bedrockModel, null, 2));
      
      console.log(`✅ Converted → ${path.relative(outputDir, outputPath)}\n`);
      successCount++;
      
    } catch (error) {
      console.error(`❌ Failed: ${error.message}\n`);
      failCount++;
      failedModels.push({ name: modelName, path: relativePath, error: error.message });
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Conversion Summary');
  console.log('='.repeat(60));
  console.log(`✅ Successful: ${successCount}`);
  console.log(`⏭️  Skipped: ${skippedCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`📁 Output directory: ${outputDir}`);
  
  if (skippedModels.length > 0 && skippedModels.length <= 10) {
    console.log('\n⏭️  Skipped models:');
    skippedModels.forEach(({ name, reason }) => {
      console.log(`  - ${name}: ${reason}`);
    });
  } else if (skippedModels.length > 10) {
    console.log(`\n⏭️  ${skippedModels.length} models skipped (no elements)`);
  }
  
  if (failedModels.length > 0) {
    console.log('\n❌ Failed models:');
    failedModels.forEach(({ path, error }) => {
      console.log(`  - ${path}`);
      console.log(`    Error: ${error}`);
    });
  }
  
  console.log('\n✨ Done!');
}

if (require.main === module) {
  main();
}

module.exports = { JavaToBedrockConverter };
