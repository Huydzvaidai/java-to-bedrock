/**
 * Automatically analyze and fix conversion formula
 * Based on Blockbench conversion patterns
 */

const fs = require('fs');
const path = require('path');

/**
 * Analyze a Java model and suggest the best conversion formula
 */
function analyzeModel(javaModel) {
  if (!javaModel.elements || javaModel.elements.length === 0) {
    throw new Error('No elements in model');
  }
  
  const analysis = {
    totalElements: javaModel.elements.length,
    hasRotations: false,
    rotationAxes: new Set(),
    boundingBox: {
      minX: Infinity, maxX: -Infinity,
      minY: Infinity, maxY: -Infinity,
      minZ: Infinity, maxZ: -Infinity
    },
    centerPoint: [0, 0, 0]
  };
  
  // Analyze all elements
  javaModel.elements.forEach(element => {
    const from = element.from;
    const to = element.to;
    
    // Update bounding box
    analysis.boundingBox.minX = Math.min(analysis.boundingBox.minX, from[0]);
    analysis.boundingBox.maxX = Math.max(analysis.boundingBox.maxX, to[0]);
    analysis.boundingBox.minY = Math.min(analysis.boundingBox.minY, from[1]);
    analysis.boundingBox.maxY = Math.max(analysis.boundingBox.maxY, to[1]);
    analysis.boundingBox.minZ = Math.min(analysis.boundingBox.minZ, from[2]);
    analysis.boundingBox.maxZ = Math.max(analysis.boundingBox.maxZ, to[2]);
    
    // Check rotations
    if (element.rotation) {
      analysis.hasRotations = true;
      analysis.rotationAxes.add(element.rotation.axis);
    }
  });
  
  // Calculate center
  analysis.centerPoint = [
    (analysis.boundingBox.minX + analysis.boundingBox.maxX) / 2,
    (analysis.boundingBox.minY + analysis.boundingBox.maxY) / 2,
    (analysis.boundingBox.minZ + analysis.boundingBox.maxZ) / 2
  ];
  
  return analysis;
}

/**
 * CORRECTED FORMULA based on Blockbench behavior
 * The key insight: Bedrock uses a different coordinate system
 */
function convertElementCorrected(element) {
  const from = element.from;
  const to = element.to;
  const roundit = (val) => Math.round(val * 10000) / 10000;
  
  // CORRECTED: Bedrock origin calculation
  // Java uses [8, 0, 8] as center, Bedrock uses [0, 0, 0]
  // The formula needs to account for this AND the fact that origin is the CORNER not center
  
  const origin = [
    roundit(8 - to[0]),      // X: flip and offset
    roundit(from[1]),         // Y: stays the same
    roundit(from[2] - 8)      // Z: offset
  ];
  
  const size = [
    roundit(to[0] - from[0]),
    roundit(to[1] - from[1]),
    roundit(to[2] - from[2])
  ];
  
  const cube = { origin, size };
  
  // Handle rotation
  if (element.rotation) {
    const rotOrigin = element.rotation.origin;
    
    cube.pivot = [
      roundit(8 - rotOrigin[0]),
      roundit(rotOrigin[1]),
      roundit(rotOrigin[2] - 8)
    ];
    
    const angle = element.rotation.angle;
    const axis = element.rotation.axis;
    
    // Rotation angles need to be negated for X and Y, but not Z
    cube.rotation = [
      axis === 'x' ? -angle : 0,
      axis === 'y' ? -angle : 0,
      axis === 'z' ? angle : 0
    ];
  }
  
  return cube;
}

/**
 * Convert Java model to Bedrock with corrected formula
 */
function convertModelCorrected(javaModel, modelName = 'corrected') {
  const analysis = analyzeModel(javaModel);
  
  console.log('\n📊 Model Analysis:');
  console.log(`   Elements: ${analysis.totalElements}`);
  console.log(`   Has Rotations: ${analysis.hasRotations}`);
  console.log(`   Rotation Axes: ${Array.from(analysis.rotationAxes).join(', ') || 'none'}`);
  console.log(`   Bounding Box: X[${analysis.boundingBox.minX}, ${analysis.boundingBox.maxX}] Y[${analysis.boundingBox.minY}, ${analysis.boundingBox.maxY}] Z[${analysis.boundingBox.minZ}, ${analysis.boundingBox.maxZ}]`);
  console.log(`   Center: [${analysis.centerPoint.map(v => v.toFixed(2)).join(', ')}]`);
  
  // Group cubes by rotation
  const cubesWithoutRotation = [];
  const rotationGroups = new Map();
  
  javaModel.elements.forEach(element => {
    const cube = convertElementCorrected(element);
    
    if (cube.rotation) {
      const key = JSON.stringify({
        pivot: cube.pivot,
        rotation: cube.rotation
      });
      
      if (!rotationGroups.has(key)) {
        rotationGroups.set(key, {
          pivot: cube.pivot,
          rotation: cube.rotation,
          cubes: []
        });
      }
      
      const cubeWithoutRot = { ...cube };
      delete cubeWithoutRot.pivot;
      delete cubeWithoutRot.rotation;
      rotationGroups.get(key).cubes.push(cubeWithoutRot);
    } else {
      cubesWithoutRotation.push(cube);
    }
  });
  
  // Build bones
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
      cubes: cubesWithoutRotation
    }
  ];
  
  // Add rotation groups
  Array.from(rotationGroups.values()).forEach((group, index) => {
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
    "minecraft:geometry": [{
      description: {
        identifier: `geometry.${modelName}`,
        texture_width: 16,
        texture_height: 16,
        visible_bounds_width: 4,
        visible_bounds_height: 4.5,
        visible_bounds_offset: [0, 0.75, 0]
      },
      bones: bones
    }]
  };
}

// Main
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node auto-fix.js <java-model.json> [output.json]');
    console.log('');
    console.log('This will convert the Java model using the CORRECTED formula');
    console.log('based on Blockbench conversion behavior.');
    process.exit(1);
  }
  
  const inputFile = args[0];
  const outputFile = args[1] || inputFile.replace('.json', '_fixed.json');
  
  if (!fs.existsSync(inputFile)) {
    console.error(`❌ File not found: ${inputFile}`);
    process.exit(1);
  }
  
  console.log(`📥 Loading: ${inputFile}`);
  const javaModel = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  
  console.log('🔄 Converting with corrected formula...');
  const bedrockModel = convertModelCorrected(javaModel, path.basename(inputFile, '.json'));
  
  fs.writeFileSync(outputFile, JSON.stringify(bedrockModel, null, 2));
  console.log(`\n✅ Saved: ${outputFile}`);
  
  console.log('\n📝 Next steps:');
  console.log('1. Open the output file in Blockbench');
  console.log('2. Compare with the original Java model');
  console.log('3. If correct, update converter.js with this formula');
}

if (require.main === module) {
  main();
}

module.exports = { analyzeModel, convertElementCorrected, convertModelCorrected };
