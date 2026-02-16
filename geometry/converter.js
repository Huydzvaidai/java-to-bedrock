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
   * Calculate UV coordinates for Bedrock
   * SIMPLE DIRECT MAPPING: No transformation, just convert format
   */
  calculateUV(face, textureKey, javaModel, faceName) {
    if (!face || !face.uv) return null;

    // Resolve texture reference (e.g., "#1" -> "shine_oni:texture")
    const textureRef = javaModel.textures[textureKey.substring(1)];
    if (!textureRef) return null;

    // Round to 4 decimal places
    const roundit = (val) => Math.round(val * 10000) / 10000;

    // Java UV format: [x1, y1, x2, y2]
    // Bedrock UV format: {uv: [x, y], uv_size: [width, height]}
    
    // Direct conversion - no special handling
    return {
      uv: [roundit(face.uv[0]), roundit(face.uv[1])],
      uv_size: [roundit(face.uv[2] - face.uv[0]), roundit(face.uv[3] - face.uv[1])]
    };
  }

  /**
   * Convert Java element to Bedrock cube
   * CORRECTED FORMULA based on Blockbench behavior and auto-fix.js
   */
  convertElement(element, javaModel) {
    const from = element.from;
    const to = element.to;

    const roundit = (val) => Math.round(val * 10000) / 10000;

    // CORRECTED: Bedrock origin calculation (from auto-fix.js)
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

    // Convert UV for each face
    if (element.faces) {
      const uvMap = {};
      
      for (const [faceName, face] of Object.entries(element.faces)) {
        if (face && face.texture) {
          const uv = this.calculateUV(face, face.texture, javaModel, faceName);
          if (uv) {
            uvMap[faceName] = uv;
          }
        }
      }
      
      if (Object.keys(uvMap).length > 0) {
        cube.uv = uvMap;
      }
    }

    // Convert rotation (corrected formula from auto-fix.js)
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
   * Group cubes by rotation pivot (like converter.sh)
   * Creates multiple rot_ bones for cubes with same rotation
   */
  groupCubesByRotation(elements, javaModel) {
    const cubes = elements.map(el => this.convertElement(el, javaModel));
    
    // Separate cubes with no rotation
    const cubesWithoutRotation = cubes.filter(cube => !cube.rotation);
    
    // Group cubes by rotation pivot and angle
    const rotationGroups = new Map();
    
    cubes.forEach(cube => {
      if (cube.rotation) {
        // Create a key from pivot and rotation
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
        
        // Remove pivot and rotation from cube (will be in bone instead)
        const cubeWithoutRotation = { ...cube };
        delete cubeWithoutRotation.pivot;
        delete cubeWithoutRotation.rotation;
        
        rotationGroups.get(key).cubes.push(cubeWithoutRotation);
      }
    });
    
    return {
      cubesWithoutRotation,
      rotationGroups: Array.from(rotationGroups.values())
    };
  }

  /**
   * Convert Java model to Bedrock format
   * SIMPLIFIED: No atlas/spritesheet needed, use direct UV mapping
   */
  convert(javaModel, modelName, outputDir, assetsDir) {
    // Always use 16x16 as texture dimensions
    this.textureWidth = 16;
    this.textureHeight = 16;

    if (!javaModel.elements || javaModel.elements.length === 0) {
      throw new Error('No elements found in model');
    }

    // Group cubes by rotation (creates multiple rot_ bones)
    const { cubesWithoutRotation, rotationGroups } = this.groupCubesByRotation(
      javaModel.elements,
      javaModel
    );

    // Build bone structure with multiple rot_ bones
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
    
    // Add rot_ bones for each rotation group
    rotationGroups.forEach((group, index) => {
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
  
  // Collect all unique textures in a namespace (only from models with elements)
  function collectAllTexturesInNamespace(namespaceDir, modelFiles) {
    const texturePaths = new Set();
    
    // Only collect textures from models that have elements
    for (const modelFile of modelFiles) {
      try {
        const modelData = JSON.parse(fs.readFileSync(modelFile, 'utf-8'));
        
        // Skip if no elements
        if (!modelData.elements || modelData.elements.length === 0) {
          continue;
        }
        
        // Collect textures from this model
        if (modelData.textures) {
          for (const textureRef of Object.values(modelData.textures)) {
            const cleanPath = textureRef.replace(/^[^:]+:/, '');
            const texturePath = path.join(namespaceDir, 'textures', cleanPath + '.png');
            
            if (fs.existsSync(texturePath)) {
              texturePaths.add(texturePath);
            }
          }
        }
      } catch (error) {
        // Skip invalid models
        continue;
      }
    }
    
    return Array.from(texturePaths);
  }
  
  console.log(`🔍 Scanning for models in ${assetsDir}...\n`);
  const modelFiles = findModelFiles(assetsDir);
  
  if (modelFiles.length === 0) {
    console.error('❌ No model files found');
    process.exit(1);
  }
  
  // Group models by namespace
  const modelsByNamespace = {};
  modelFiles.forEach(filePath => {
    const relativePath = path.relative(assetsDir, filePath);
    const namespace = relativePath.split(path.sep)[0];
    
    if (!modelsByNamespace[namespace]) {
      modelsByNamespace[namespace] = [];
    }
    modelsByNamespace[namespace].push(filePath);
  });
  
  console.log(`📦 Found ${modelFiles.length} model files in ${Object.keys(modelsByNamespace).length} namespace(s)\n`);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;
  const failedModels = [];
  
  // Process each namespace
  for (const [namespace, files] of Object.entries(modelsByNamespace)) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`� Processing namespace: ${namespace}`);
    console.log(`${'='.repeat(60)}\n`);
    
    const namespaceAssetsDir = path.join(assetsDir, namespace);
    const namespaceOutputDir = path.join(outputDir, namespace);
    
    if (!fs.existsSync(namespaceOutputDir)) {
      fs.mkdirSync(namespaceOutputDir, { recursive: true });
    }
    
    // Generate ONE atlas for entire namespace
    console.log(`🎨 Generating atlas for namespace: ${namespace}`);
    const allTextures = collectAllTexturesInNamespace(namespaceAssetsDir, files);
    
    if (allTextures.length > 0) {
      console.log(`  📦 Found ${allTextures.length} texture(s) in namespace`);
      
      // Crop animated textures
      const processedPaths = [];
      for (const texturePath of allTextures) {
        const mcmetaPath = texturePath + '.mcmeta';
        
        if (fs.existsSync(mcmetaPath)) {
          try {
            const tempPath = texturePath.replace('.png', '_cropped.png');
            execSync(`convert "${texturePath}" -set option:distort:viewport "%[fx:min(w,h)]x%[fx:min(w,h)]" -distort affine "0,0 0,0" -define png:format=png8 -clamp "${tempPath}"`, {
              stdio: 'pipe'
            });
            processedPaths.push(tempPath);
            console.log(`  🎞️  Cropped animated: ${path.basename(texturePath)}`);
          } catch (error) {
            console.warn(`  ⚠️  Failed to crop ${path.basename(texturePath)}, using original`);
            processedPaths.push(texturePath);
          }
        } else {
          processedPaths.push(texturePath);
        }
      }
      
      // Generate spritesheet for namespace
      try {
        const spritesheetPath = path.join(namespaceOutputDir, namespace);
        
        // Convert input paths to absolute, but keep output path relative
        const absolutePaths = processedPaths.map(p => path.resolve(p));
        const cmd = `spritesheet-js -f json --name "${spritesheetPath}" --padding 0 --fullpath ${absolutePaths.map(p => `"${p}"`).join(' ')}`;
        
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
          const spritesheetData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
          console.log(`  ✅ Generated atlas: ${namespace}.png (${spritesheetData.meta.size.w}x${spritesheetData.meta.size.h})\n`);
          
          // Store spritesheet data for all converters in this namespace
          const sharedConverter = new JavaToBedrockConverter();
          sharedConverter.spritesheetData = spritesheetData;
          
          // Convert all models in namespace using shared atlas
          for (const filePath of files) {
            const relativePath = path.relative(assetsDir, filePath);
            const parts = relativePath.split(path.sep);
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
              
              const modelOutputDir = path.join(namespaceOutputDir, modelPath || '');
              if (!fs.existsSync(modelOutputDir)) {
                fs.mkdirSync(modelOutputDir, { recursive: true });
              }
              
              // Use shared converter with atlas data
              const bedrockModel = sharedConverter.convert(javaModel, modelName, modelOutputDir, namespaceAssetsDir);
              
              const outputPath = path.join(modelOutputDir, `${fileName}.json`);
              fs.writeFileSync(outputPath, JSON.stringify(bedrockModel, null, 2));
              
              console.log(`✅ Converted → ${path.relative(outputDir, outputPath)}\n`);
              successCount++;
              
            } catch (error) {
              console.error(`❌ Failed: ${error.message}\n`);
              failCount++;
              failedModels.push({ name: modelName, path: relativePath, error: error.message });
            }
          }
          
          // Clean up JSON metadata
          try { fs.unlinkSync(jsonPath); } catch (e) {}
          
        } else {
          console.warn(`  ⚠️  Atlas files not created, skipping namespace\n`);
          skippedCount += files.length;
        }
        
      } catch (error) {
        console.error(`  ❌ Atlas generation failed: ${error.message}\n`);
        skippedCount += files.length;
      }
      
    } else {
      console.log(`  ⚠️  No textures found in namespace, skipping\n`);
      skippedCount += files.length;
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
