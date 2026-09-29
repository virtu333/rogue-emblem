import { it } from 'vitest';
import * as prettier from 'prettier';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

it('exports formatting diagnostics for the constrained implementation workspace', async () => {
  const paths = [
    'schemas/specialChars.schema.json',
    'src/engine/DataLoader.js',
    'src/engine/FinaleRally.js',
    'src/engine/MasterySystem.js',
    'src/engine/PortraitVariants.js',
    'src/engine/RecruitNodeSystem.js',
    'src/engine/RecruitScaling.js',
    'src/engine/RevivalCatchUp.js',
    'src/engine/RosterCommands.js',
    'src/engine/RunManager.js',
    'src/engine/RunRecords.js',
    'src/engine/SpecialCharacterDialogue.js',
    'src/engine/SpecialCharacterPolicy.js',
    'src/engine/SpecialCharacters.js',
    'src/engine/UnitManager.js',
    'src/engine/UnitVoice.js',
    'src/scenes/BattleScene.js',
    'src/scenes/NodeMapScene.js',
    'src/scenes/RunCompleteScene.js',
    'src/ui/BattleBeatsController.js',
    'src/ui/BattlePresentationCheckpoint.js',
    'src/ui/BattleUnitVisuals.js',
    'src/ui/ChurchMenu.js',
    'src/ui/MobileRosterSheet.js',
    'src/ui/Pc98PortraitManifest.json',
    'src/ui/RebuiltPortraitManifest.json',
    'src/ui/RebuiltPortraits.js',
    'src/ui/RebuiltSpriteManifest.json',
    'src/ui/RebuiltSprites.js',
    'src/ui/RunFlowMenus.js',
    'src/ui/RunRecordsMenu.js',
    'src/ui/UnitDetailOverlay.js',
    'src/ui/ceremonyPortraitFraming.json',
    'src/ui/portraitArt.js',
    'tests/Gaspar.test.js',
    'tests/RunManager.test.js',
    'tests/testData.js',
    'tools/art/pc98/build.mjs',
    'tools/bakeSpecialCharacters.mjs',
    'tools/validateCrossReferences.js',
    'tools/validateSchemas.js',
    'src/utils/devStartup.js',
    'tests/BattleSceneLockedDeploy.test.js',
    'tests/CommanderChoice.test.js',
    'tests/DevStartup.test.js',
    'tests/EarlyEnemyRules.test.js',
    'tests/LordTraitsMetaTexture.test.js',
    'tests/PortraitVariants.test.js',
    'tests/SignatureWeapons.test.js',
    'tests/firstRunFastPath.test.js',
    'tests/e2e/portrait-services.spec.js',
    'tests/e2e/battlefield-presentation.spec.js',
  ];
  const config = JSON.parse(readFileSync('.prettierrc', 'utf8'));
  for (const path of paths) {
    writeFileSync(
      path,
      await prettier.format(readFileSync(path, 'utf8'), { ...config, filepath: path }),
    );
  }
  const patch = execFileSync('git', ['diff', '--no-ext-diff', '--unified=0'], { encoding: 'utf8' });
  console.log('GASPAR_FORMAT_PATCH=' + Buffer.from(patch).toString('base64'));
}, 30000);
