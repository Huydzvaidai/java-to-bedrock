const fs = require('fs');
const path = require('path');

class JavaToBedrockConverter {
  constructor() {
    this.textureWidth = 16;
    this.textureHeight = 16;
  }

  convert(javaModel, modelName) {
    if (javaModel.texture_size) {
      this.textureWidth = javaModel.texture_size[0];
      this.textureHeight = javaModel.texture_size[1];
    }

    const cubes = javaModel.elements 
      ? javaModel.elements.map(element => this.convertElement(element))
      : [];

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
        pivot: [0, 8, 0]
      },
      {
        name: modelName,
        parent: "campfire_z",
        pivot: [8, 0, -8],
        cubes: cubes
      }
    ];

    return {
      format_version: "1.21.0",
      "minecraft:geometry": [
        {
          description: {
            identifier: `geometry.${modelName}`,
            texture_width: this.textureWidth,
            texture_height: this.textureHeight,
            visible_bounds_width: 6,
            visible_bounds_height: 6,
            visible_bounds_offset: [0, 2, 0]
          },
          bones: bones
        }
      ]
    };
  }

  convertElement(element) {
    const from = element.from;
    const to = element.to;

    const origin = [
      from[0] - 8,
      from[1],
      from[2] - 8
    ];

    const size = [
      to[0] - from[0],
      to[1] - from[1],
      to[2] - from[2]
    ];

    const cube = {
      origin,
      size
    };

    if (element.faces) {
      cube.uv = this.convertFaces(element.faces, size);
    }

    if (element.rotation) {
      cube.pivot = element.rotation.origin.map((v, i) => 
        i === 0 || i === 2 ? v - 8 : v
      );
      
      const angle = element.rotation.angle;
      const axis = element.rotation.axis;
      
      cube.rotation = [
        axis === 'x' ? angle : 0,
        axis === 'y' ? angle : 0,
        axis === 'z' ? angle : 0
      ];
    }

    return cube;
  }

  convertFaces(faces, size) {
    const bedrockUV = {};

    const faceMap = {
      north: 'north',
      south: 'south',
      east: 'east',
      west: 'west',
      up: 'up',
      down: 'down'
    };

    for (const [javaFace, bedrockFace] of Object.entries(faceMap)) {
      const face = faces[javaFace];
      if (face && face.uv) {
        bedrockUV[bedrockFace] = {
          uv: [face.uv[0], face.uv[1]],
          uv_size: [
            face.uv[2] - face.uv[0],
            face.uv[3] - face.uv[1]
          ]
        };
      }
    }

    return bedrockUV;
  }
}

// Main function
function main() {
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
  
  // Input path
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
    const bedrockModel = converter.convert(javaModel, modelName);
    
    // Create output directory
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

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { JavaToBedrockConverter };
