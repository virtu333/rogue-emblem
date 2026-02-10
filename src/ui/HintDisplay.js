// HintDisplay — Two display functions for tutorial hints
// Important hints require dismiss (Space/Enter/click). Minor hints auto-fade.

const DEPTH = 960;

/**
 * Show a centered hint box that blocks until the player dismisses it.
 * Returns a Promise that resolves when Space, Enter, or click is pressed.
 */
export function showImportantHint(scene, message) {
  return new Promise((resolve) => {
    const cam = scene.cameras.main;
    const cx = cam.centerX;
    const cy = cam.centerY;
    const objects = [];

    // Dark box background
    const textObj = scene.add.text(cx, cy - 10, message, {
      fontFamily: 'monospace', fontSize: '12px', color: '#ffdd44',
      align: 'center', wordWrap: { width: 420 }, lineSpacing: 4,
    }).setOrigin(0.5).setDepth(DEPTH + 1).setAlpha(0);

    const footerObj = scene.add.text(cx, 0, '[Space / Click to continue]', {
      fontFamily: 'monospace', fontSize: '9px', color: '#888888',
      align: 'center',
    }).setOrigin(0.5).setDepth(DEPTH + 1).setAlpha(0);

    // Size box around text
    const padX = 30;
    const padTop = 20;
    const padBottom = 32;
    const boxW = textObj.width + padX * 2;
    const boxH = textObj.height + padTop + padBottom;
    const boxY = cy - 10;

    footerObj.setY(boxY + boxH / 2 - 14);

    const bg = scene.add.rectangle(cx, boxY, boxW, boxH, 0x000000, 0.92)
      .setStrokeStyle(2, 0xffdd44).setDepth(DEPTH).setAlpha(0);

    objects.push(bg, textObj, footerObj);

    // Fade in
    for (const obj of objects) {
      scene.tweens.add({ targets: obj, alpha: 1, duration: 200 });
    }

    // Dismiss handler
    const cleanup = () => {
      spaceKey.off('down', onDismiss);
      enterKey.off('down', onDismiss);
      bg.off('pointerdown', onDismiss);
      for (const obj of objects) obj.destroy();
      resolve();
    };

    let dismissed = false;
    const onDismiss = () => {
      if (dismissed) return;
      dismissed = true;
      cleanup();
    };

    const spaceKey = scene.input.keyboard.addKey('SPACE');
    const enterKey = scene.input.keyboard.addKey('ENTER');
    spaceKey.on('down', onDismiss);
    enterKey.on('down', onDismiss);
    bg.setInteractive().on('pointerdown', onDismiss);
  });
}

/**
 * Show a minor hint at the bottom of the screen that auto-fades.
 * Non-blocking. Returns a Promise for optional chaining.
 */
export function showMinorHint(scene, message) {
  return new Promise((resolve) => {
    const cam = scene.cameras.main;
    const cx = cam.centerX;
    const y = cam.height - 40;

    const text = scene.add.text(cx, y, message, {
      fontFamily: 'monospace', fontSize: '11px', color: '#ffdd44',
      align: 'center', backgroundColor: '#000000cc', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(DEPTH).setAlpha(0);

    // Fade in → hold → fade out → destroy
    scene.tweens.add({
      targets: text,
      alpha: 1,
      duration: 200,
      onComplete: () => {
        scene.tweens.add({
          targets: text,
          alpha: 0,
          delay: 2500,
          duration: 200,
          onComplete: () => {
            text.destroy();
            resolve();
          },
        });
      },
    });
  });
}
