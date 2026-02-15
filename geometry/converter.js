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
   * Generate spritesheet from model textures
   */
  generateSpritesheet(javaModel, modelName, outputDir) {
    const texturesDir = path.join(outputDir, 'textures_temp');
    if (!fs.existsSync(texturesDir)) {
      fs.mkdirSync(texturesDir, { recursive: true });
    }

    // Extract texture paths from model
    const texturePaths = [];
    if (javaModel.textures) {
      for (const [key, value] of Object.entries(javaModel.textures)) {
        const texturePath = path.join(__dirname, '../lunarset/textures', value.replace('lunarset:', '') + '.png');
        if (fs.existsSync(texturePath)) {
          texturePaths.push(texturePath);
        }
      }
    }

    if (texturePaths.length === 0) {
      console.log('⚠️  No textures found, using fallback');
      return null;
    }

    // Generate spritesheet using spritesheet-js
    const spritesheetPath = path.join(outputDir, modelName);
    try {
      execSync(`spritesheet-js -f json --name ${spritesheetPath} --fullpath ${texturePaths.join(' ')}`, {
        stdio: 'inherit'
      });
      
      // Read generated spritesheet data
      const spritesheetJsonPath = `${spritesheetPath}.json`;
      if (fs.existsSync(spritesheetJsonPath)) {
        this.spritesheetData = JSON.parse(fs.readFileSync(spritesheetJsonPath, 'utf-8'));
        return `${modelName}.png`;
      }
    } catch (error) {
      console.error('Failed to generate spritesheet:', error.message);
    }

    return null;
  }

  /**
   * Get texture data from spritesheet
   */
  getTextureData(texturePath) {
    if (!this.spritesheetData || !this.spritesheetData.frames) {
      return null;
    }

    const fullPath = path.join(__dirname, '../lunarset/textures', texturePath.replace('lunarset:', '') + '.png');
    return this.spritesheetData.frames[fullPath];
  }

  /**
   * Calculate UV from spritesheet
   */
  calculateUV(face, textureKey, javaModel) {
    if (!face || !face.uv) return null;

    const texturePath = javaModel.textures[textureKey.substring(1)];
    if (!texturePath) return null;

    const textureData = this.getTextureData(texturePath);
    if (!textureData) {
      // Fallback to simple UV if no spritesheet
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

    // Calculate UV coordinates in atlas space
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

  /**
   * Convert Java element to Bedrock cube
   */
  convertElement(element, javaModel) {
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

    const cube = {
      origin,
      size
    };

    // Convert UV mapping
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

    // Convert rotation
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

  /**
   * Group cubes by rotation pivot
   */
  groupCubesByRotation(elements, javaModel) {
    const cubes = elements.map(el => this.convertElement(el, javaModel));
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

  /**
   * Convert Java model to Bedrock format
   */
  convert(javaModel, modelName, outputDir) {
    if (javaModel.texture_size) {
      this.textureWidth = javaModel.texture_size[0];
      this.textureHeight = javaModel.texture_size[1];
    }

    // Generate spritesheet
    const spritesheetFile = this.generateSpritesheet(javaModel, modelName, outputDir);

    if (!javaModel.elements || javaModel.elements.length === 0) {
      throw new Error('No elements found in model');
    }

    // Group cubes by rotation
    const { groups, noPivotCubes } = this.groupCubesByRotation(javaModel.elements, javaModel);

    // Build bones structure
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
  
  if (args.length < 1) {
    console.log('Usage: node converter.js <model_name> [output_dir]');
    console.log('');
    console.log('Converts Java model from ../lunarset/models/<model_name>.json to Bedrock format');
    console.log('');
    console.log('Examples:');
    console.log('  node converter.js sword');
    console.log('  node converter.js axe ../output');
    console.log('');
    console.log('Available models:');
    const modelsDir = path.join(__dirname, '../lunarset/models');
    if (fs.existsSync(modelsDir)) {
      const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.json'));
      files.forEach(f => console.log(`  - ${f.replace('.json', '')}`));
    }
    process.exit(1);
  }
  
  const modelName = args[0];
  const outputDir = args[1] || path.join(__dirname, '../output');
  
  const inputPath = path.join(__dirname, '../lunarset/models', `${modelName}.json`);
  
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Model not found: ${inputPath}`);
    console.log('\nAvailable models:');
    const modelsDir = path.join(__dirname, '../lunarset/models');
    if (fs.existsSync(modelsDir)) {
      const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.json'));
      files.forEach(f => console.log(`  - ${f.replace('.json', '')}`));
    }
    process.exit(1);
  }
  
  try {
    console.log(`📥 Reading ${modelName}.json...`);
    const javaModelJson = fs.readFileSync(inputPath, 'utf-8');
    const javaModel = JSON.parse(javaModelJson);
    
    console.log(`🔄 Converting to Bedrock format...`);
    const converter = new JavaToBedrockConverter();
    const bedrockModel = converter.convert(javaModel, modelName, outputDir);
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputPath = path.join(outputDir, `${modelName}_bedrock.json`);
    fs.writeFileSync(outputPath, JSON.stringify(bedrockModel, null, 2));
    
    console.log(`✅ Conversion successful!`);
    console.log(`📄 Output: ${outputPath}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { JavaToBedrockConverter };
