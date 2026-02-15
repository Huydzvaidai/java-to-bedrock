const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class JavaToBedrockConverter {
  constructor() {
    this.textureWidth = 16;
    this.textureHeight = 16;
    this.spritesheetData = null;
  }

  /**
   * Collect all unique texture paths from model
   */
  collectTexturePaths(javaModel, assetsDir) {
    const texturePaths = [];
    const seen = new Set();
    
    if (!javaModel.textures) return texturePaths;
    
    for (const [key, value] of Object.entries(javaModel.textures)) {
      const cleanPath = value.replace(/^[^:]+:/, '');
      const texturePath = path.join(assetsDir, 'textures', cleanPath + '.png');
      
      if (!seen.has(texturePath) && fs.existsSync(texturePath)) {
        texturePaths.push(texturePath);
        seen.add(texturePath);
      }
    }
    
    return texturePaths;
  }

  /**
   * Crop animated textures to first frame
   */
  cropAnimatedTextures(texturePaths) {
    const croppedPaths = [];
    
    for (const texturePath of texturePaths) {
      const mcmetaPath = texturePath + '.mcmeta';
      
      // Check if this is an animated texture
      if (fs.existsSync(mcmetaPath)) {
        try {
          // Use ImageMagick to crop to square (first frame)
          const tempPath = texturePath.replace('.png', '_cropped.png');
          execSync(`convert "${texturePath}" -set option:distort:viewport "%[fx:min(w,h)]x%[fx:min(w,h)]" -distort affine "0,0 0,0" -define png:format=png8 -clamp "${tempPath}"`, {
            stdio: 'pipe'
          });
          croppedPaths.push(tempPath);
          console.log(`  🎞️  Cropped animated texture: ${path.basename(texturePath)}`);
        } catch (error) {
          console.warn(`  ⚠️  Failed to crop ${path.basename(texturePath)}, using original`);
          croppedPaths.push(texturePath);
        }
      } else {
        croppedPaths.push(texturePath);
      }
    }
    
    return croppedPaths;
  }

  /**
   * Generate spritesheet from all textures in model
   */
  generateSpritesheet(javaModel, outputName, outputDir, assetsDir) {
    // Collect all texture paths from model
    const texturePaths = this.collectTexturePaths(javaModel, assetsDir);
    
    if (texturePaths.length === 0) {
      console.log(`  ⚠️  No textures found`);
      return null;
    }

    console.log(`  📦 Found ${texturePaths.length} texture(s) to atlas`);

    // Crop animated textures first
    const processedPaths = this.cropAnimatedTextures(texturePaths);

    try {
      const spritesheetPath = path.join(outputDir, outputName);
      const cmd = `spritesheet-js -f json --name "${spritesheetPath}" --fullpath ${processedPaths.map(p => `"${p}"`).join(' ')}`;
      
      execSync(cmd, { stdio: 'inherit' });
      
      // Clean up cropped temp files
      processedPaths.forEach(p => {
        if (p.includes('_cropped.png')) {
          try { fs.unlinkSync(p); } catch (e) {}
        }
      });
      
      const jsonPath = `${spritesheetPath}.json`;
      const pngPath = `${spritesheetPath}.png`;
      
      if (fs.existsSync(jsonPath) && fs.existsSync(pngPath)) {
        this.spritesheetData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        console.log(`  ✅ Generated spritesheet: ${outputName}.png (${this.spritesheetData.meta.size.w}x${this.spritesheetData.meta.size.h})`);
        
        // Clean up the JSON metadata file
        try { fs.unlinkSync(jsonPath); } catch (e) {}
        
        return `${outputName}.png`;
      } else {
        console.warn(`  ⚠️  Spritesheet files not created`);
      }
    } catch (error) {
      console.warn(`  ⚠️  Spritesheet generation failed: ${error.message}`);
    }
    return null;
  }

  /**
   * Calculate UV coordinates in atlas space (exact formula from converter.sh)
   */
  calculateUV(face, textureKey, javaModel) {
    if (!face || !face.uv) return null;

    const textureRef = javaModel.textures[textureKey.substring(1)];
    if (!textureRef) return null;

    // If no spritesheet, use simple UV
    if (!this.spritesheetData || !this.spritesheetData.frames) {
      return {
        uv: [face.uv[0], face.uv[1]],
        uv_size: [face.uv[2] - face.uv[0], face.uv[3] - face.uv[1]]
      };
    }

    // Find texture in spritesheet by matching path
    const cleanPath = textureRef.replace(/^[^:]+:/, '');
    let textureData = null;
    
    for (const [framePath, data] of Object.entries(this.spritesheetData.frames)) {
      if (framePath.includes(cleanPath + '.png') || framePath.includes(cleanPath + '_cropped.png')) {
        textureData = data;
        break;
      }
    }

    if (!textureData) {
      return {
        uv: [face.uv[0], face.uv[1]],
        uv_size: [face.uv[2] - face.uv[0], face.uv[3] - face.uv[1]]
      };
    }

    // Extract atlas and frame dimensions
    const atlasWidth = this.spritesheetData.meta.size.w;
    const atlasHeight = this.spritesheetData.meta.size.h;
    const frameX = textureData.frame.x;
    const frameY = textureData.frame.y;
    const frameW = textureData.frame.w;
    const frameH = textureData.frame.h;

    // Calculate UV in atlas space (exact formula from converter.sh)
    const fn0 = ((face.uv[0] * frameW * 0.0625) + frameX) * (16 / atlasWidth);
    const fn1 = ((face.uv[1] * frameH * 0.0625) + frameY) * (16 / atlasHeight);
    const fn2 = ((face.uv[2] * frameW * 0.0625) + frameX) * (16 / atlasWidth);
    const fn3 = ((face.uv[3] * frameH * 0.0625) + frameY) * (16 / atlasHeight);

    // Calculate signs for UV adjustment
    const xSign = Math.max(-1, Math.min(1, fn2 - fn0));
    const ySign = Math.max(-1, Math.min(1, fn3 - fn1));

    // Round to 4 decimal places
    const roundit = (val) => Math.round(val * 10000) / 10000;

    return {
      uv: [
        roundit(fn0 + (0.016 * xSign)),
        roundit(fn1 + (0.016 * ySign))
      ],
      uv_size: [
        roundit((fn2 - fn0) - (0.016 * xSign)),
        roundit((fn3 - fn1) - (0.016 * ySign))
      ]
    };
  }

  /**
   * Convert Java element to Bedrock cube
   */
  convertElement(element, javaModel) {
    const from = element.from;
    const to = element.to;

    const roundit = (val) => Math.round(val * 10000) / 10000;

    // Calculate origin and size (exact formula from converter.sh)
    const origin = [
      roundit(-to[0] + 8),
      roundit(from[1]),
      roundit(from[2] - 8)
    ];

    const size = [
      roundit(to[0] - from[0]),
      roundit(to[1] - from[1]),
      roundit(to[2] - from[2])
    ];

    const cube = { origin, size };

    // Convert UV for each face
    if (element.faces) {
      const uvMap = {};
      
      for (const [faceName, face] of Object.entries(element.faces)) {
        if (face && face.texture) {
          const uv = this.calculateUV(face, face.texture, javaModel);
          if (uv) {
            uvMap[faceName] = uv;
          }
        }
      }
      
      if (Object.keys(uvMap).length > 0) {
        cube.uv = uvMap;
      }
    }

    // Convert rotation (exact formula from converter.sh)
    if (element.rotation) {
      cube.pivot = [
        roundit(-element.rotation.origin[0] + 8),
        roundit(element.rotation.origin[1]),
        roundit(element.rotation.origin[2] - 8)
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

  /**
   * Group cubes by rotation pivot (exact logic from converter.sh)
   */
  groupCubesByRotation(elements, javaModel) {
    const cubes = elements.map(el => this.convertElement(el, javaModel));
    
    // Get unique rotations
    const rotations = [];
    elements.forEach(el => {
      if (el.rotation) {
        const key = JSON.stringify({
          origin: el.rotation.origin,
          angle: el.rotation.angle,
          axis: el.rotation.axis
        });
        
        if (!rotations.find(r => r.key === key)) {
          rotations.push({
            key,
            origin: el.rotation.origin,
            angle: el.rotation.angle,
            axis: el.rotation.axis
          });
        }
      }
    });

    const roundit = (val) => Math.round(val * 10000) / 10000;

    // Create rotation groups
    const groups = rotations.map(rot => {
      const pivot = [
        roundit(-rot.origin[0] + 8),
        roundit(rot.origin[1]),
        roundit(rot.origin[2] - 8)
      ];

      const rotation = [
        rot.axis === 'x' ? -rot.angle : 0,
        rot.axis === 'y' ? -rot.angle : 0,
        rot.axis === 'z' ? rot.angle : 0
      ];

      const groupCubes = [];
      
      cubes.forEach((cube, idx) => {
        if (elements[idx].rotation &&
            JSON.stringify(cube.rotation) === JSON.stringify(rotation) &&
            JSON.stringify(cube.pivot) === JSON.stringify(pivot)) {
          const cubeWithoutPivot = { ...cube };
          delete cubeWithoutPivot.pivot;
          delete cubeWithoutPivot.rotation;
          groupCubes.push(cubeWithoutPivot);
        }
      });

      return {
        pivot,
        rotation,
        cubes: groupCubes
      };
    });

    // Get cubes without rotation
    const noPivotCubes = [];
    cubes.forEach((cube, idx) => {
      if (!elements[idx].rotation) {
        const cubeWithoutPivot = { ...cube };
        delete cubeWithoutPivot.pivot;
        delete cubeWithoutPivot.rotation;
        noPivotCubes.push(cubeWithoutPivot);
      }
    });

    return { groups, noPivotCubes };
  }

  /**
   * Convert Java model to Bedrock format
   */
  convert(javaModel, modelName, outputDir, assetsDir) {
    // Extract texture size
    if (javaModel.texture_size) {
      this.textureWidth = javaModel.texture_size[0];
      this.textureHeight = javaModel.texture_size[1];
    }

    if (!javaModel.elements || javaModel.elements.length === 0) {
      throw new Error('No elements found in model');
    }

    // Generate spritesheet from ALL textures in model
    this.generateSpritesheet(javaModel, modelName, outputDir, assetsDir);

    // Group cubes by rotation
    const { groups, noPivotCubes } = this.groupCubesByRotation(
      javaModel.elements,
      javaModel
    );

    // Build bone structure (exact structure from converter.sh)
    const bones = [
      {
        name: "campfire",
        binding: "c.item_slot == 'head' ? 'head' : q.item_slot_to_bone_name(c.item_slot)",
        pivot: [0, 8, 0]
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

    // Add rotation groups as bones
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

// Main function
async function main() {
  const args = process.argv.slice(2);
  const inputPack = args[0];
  const outputDir = args[1] || path.join(__dirname, '../output');
  
  if (!inputPack) {
    console.log('Usage: node converter.js <input_pack_dir> [output_dir]');
    console.log('');
    console.log('Examples:');
    console.log('  node converter.js ..');
    console.log('  node converter.js .. ../output');
    process.exit(1);
  }
  
  const assetsDir = path.join(inputPack, 'assets');
  
  if (!fs.existsSync(assetsDir)) {
    console.error(`❌ Assets directory not found: ${assetsDir}`);
    process.exit(1);
  }
  
  // Find all model files recursively
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
    console.error('❌ No model files found');
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
        continue;
      }
      
      const namespaceOutputDir = path.join(outputDir, namespace, modelPath || '');
      if (!fs.existsSync(namespaceOutputDir)) {
        fs.mkdirSync(namespaceOutputDir, { recursive: true });
      }
      
      const namespaceAssetsDir = path.join(assetsDir, namespace);
      const converter = new JavaToBedrockConverter();
      const bedrockModel = converter.convert(javaModel, modelName, namespaceOutputDir, namespaceAssetsDir);
      
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
  console.log(`📁 Output: ${outputDir}`);
  
  if (failedModels.length > 0) {
    console.log('\n❌ Failed models:');
    failedModels.forEach(({ path, error }) => {
      console.log(`  - ${path}: ${error}`);
    });
  }
  
  console.log('\n✨ Done!');
}

if (require.main === module) {
  main();
}

module.exports = { JavaToBedrockConverter };
