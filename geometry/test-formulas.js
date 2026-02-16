/**
 * Test different conversion formulas to find the correct one
 * This script generates multiple versions of the same model with different formulas
 */

const fs = require('fs');
const path = require('path');

// Different conversion formulas to test
const FORMULAS = {
  // Current formula (from converter.sh)
  current: {
    name: "Current (converter.sh)",
    origin: (from, to) => [
      -to[0] + 8,
      from[1],
      from[2] - 8
    ],
    pivot: (origin) => [
      -origin[0] + 8,
      origin[1],
      origin[2] - 8
    ],
    rotation: (angle, axis) => [
      axis === 'x' ? -angle : 0,
      axis === 'y' ? -angle : 0,
      axis === 'z' ? angle : 0
    ]
  },
  
  // Alternative 1: Different origin calculation
  alt1: {
    name: "Alt1: Inverted Z",
    origin: (from, to) => [
      -to[0] + 8,
      from[1],
      -(from[2] - 8)  // Inverted Z
    ],
    pivot: (origin) => [
      -origin[0] + 8,
      origin[1],
      -(origin[2] - 8)
    ],
    rotation: (angle, axis) => [
      axis === 'x' ? -angle : 0,
      axis === 'y' ? -angle : 0,
      axis === 'z' ? angle : 0
    ]
  },
  
  // Alternative 2: Use from instead of to for X
  alt2: {
    name: "Alt2: Use from[0]",
    origin: (from, to) => [
      -from[0] + 8,  // Use from instead of to
      from[1],
      from[2] - 8
    ],
    pivot: (origin) => [
      -origin[0] + 8,
      origin[1],
      origin[2] - 8
    ],
    rotation: (angle, axis) => [
      axis === 'x' ? -angle : 0,
      axis === 'y' ? -angle : 0,
      axis === 'z' ? angle : 0
    ]
  },
  
  // Alternative 3: Blockbench-style (center-based)
  alt3: {
    name: "Alt3: Center-based",
    origin: (from, to) => [
      -(from[0] + to[0]) / 2 + 8,  // Use center
      from[1],
      (from[2] + to[2]) / 2 - 8
    ],
    pivot: (origin) => [
      -origin[0] + 8,
      origin[1],
      origin[2] - 8
    ],
    rotation: (angle, axis) => [
      axis === 'x' ? -angle : 0,
      axis === 'y' ? -angle : 0,
      axis === 'z' ? angle : 0
    ]
  },
  
  // Alternative 4: No negation on rotations
  alt4: {
    name: "Alt4: No rotation negation",
    origin: (from, to) => [
      -to[0] + 8,
      from[1],
      from[2] - 8
    ],
    pivot: (origin) => [
      -origin[0] + 8,
      origin[1],
      origin[2] - 8
    ],
    rotation: (angle, axis) => [
      axis === 'x' ? angle : 0,  // No negation
      axis === 'y' ? angle : 0,  // No negation
      axis === 'z' ? angle : 0
    ]
  },
  
  // Alternative 5: Swap X and Z
  alt5: {
    name: "Alt5: Swap X and Z",
    origin: (from, to) => [
      from[2] - 8,  // Use Z for X
      from[1],
      -to[0] + 8   // Use X for Z
    ],
    pivot: (origin) => [
      origin[2] - 8,
      origin[1],
      -origin[0] + 8
    ],
    rotation: (angle, axis) => [
      axis === 'z' ? -angle : 0,  // Swap axes
      axis === 'y' ? -angle : 0,
      axis === 'x' ? angle : 0
    ]
  }
};

function convertWithFormula(javaModel, formulaKey) {
  const formula = FORMULAS[formulaKey];
  const roundit = (val) => Math.round(val * 10000) / 10000;
  
  const cubes = javaModel.elements.map(element => {
    const from = element.from;
    const to = element.to;
    
    const origin = formula.origin(from, to).map(roundit);
    const size = [
      roundit(to[0] - from[0]),
      roundit(to[1] - from[1]),
      roundit(to[2] - from[2])
    ];
    
    const cube = { origin, size };
    
    if (element.rotation) {
      cube.pivot = formula.pivot(element.rotation.origin).map(roundit);
      cube.rotation = formula.rotation(element.rotation.angle, element.rotation.axis);
    }
    
    return cube;
  });
  
  return {
    format_version: "1.21.0",
    "minecraft:geometry": [{
      description: {
        identifier: `geometry.test_${formulaKey}`,
        texture_width: 16,
        texture_height: 16,
        visible_bounds_width: 4,
        visible_bounds_height: 4.5,
        visible_bounds_offset: [0, 0.75, 0]
      },
      bones: [
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
          cubes: cubes
        }
      ]
    }]
  };
}

// Main function
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node test-formulas.js <java-model.json>');
    console.log('');
    console.log('This will generate multiple Bedrock models with different conversion formulas');
    console.log('to help identify the correct formula.');
    process.exit(1);
  }
  
  const inputFile = args[0];
  
  if (!fs.existsSync(inputFile)) {
    console.error(`Error: File not found: ${inputFile}`);
    process.exit(1);
  }
  
  console.log(`📥 Loading Java model: ${inputFile}\n`);
  const javaModel = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
  
  if (!javaModel.elements || javaModel.elements.length === 0) {
    console.error('Error: No elements found in Java model');
    process.exit(1);
  }
  
  console.log(`✅ Found ${javaModel.elements.length} elements\n`);
  console.log('🔄 Generating models with different formulas...\n');
  
  const outputDir = path.join(path.dirname(inputFile), 'formula_tests');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  Object.keys(FORMULAS).forEach(key => {
    const formula = FORMULAS[key];
    const bedrockModel = convertWithFormula(javaModel, key);
    const outputFile = path.join(outputDir, `${key}.json`);
    
    fs.writeFileSync(outputFile, JSON.stringify(bedrockModel, null, 2));
    console.log(`✅ ${formula.name}`);
    console.log(`   → ${outputFile}`);
    
    // Show first cube comparison
    if (javaModel.elements.length > 0) {
      const javaEl = javaModel.elements[0];
      const bedrockCube = bedrockModel['minecraft:geometry'][0].bones[3].cubes[0];
      console.log(`   Java: from=[${javaEl.from}] to=[${javaEl.to}]`);
      console.log(`   Bedrock: origin=[${bedrockCube.origin}] size=[${bedrockCube.size}]`);
    }
    console.log('');
  });
  
  console.log(`\n📁 All test models saved to: ${outputDir}`);
  console.log('\n📝 Next steps:');
  console.log('1. Import each model into Blockbench');
  console.log('2. Compare with the original Java model');
  console.log('3. Identify which formula produces the correct result');
  console.log('4. Update converter.js with the correct formula');
}

if (require.main === module) {
  main();
}

module.exports = { FORMULAS, convertWithFormula };
