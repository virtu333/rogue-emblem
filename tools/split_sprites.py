"""
Sprite Sheet Splitter for AI-Generated Sprite Sheets

Handles images where the "transparent" checkerboard is baked in as solid pixels.
Uses FFT to detect grid spacing, then splits into individual sprites.

For grid-based sheets (characters): auto-detects period and phase.
For irregular sheets (UI icons, terrain): uses connected-component detection
on a background-masked version.

Usage:
  python tools/split_sprites.py <input_image> <output_dir> [options]

Options:
  --mode grid|detect   Force grid or detect mode (default: auto)
  --min-size N         Min sprite dimension to keep (default: 20)
  --padding N          Padding around each crop (default: 2)
  --bg-color R,G,B     Background color override (default: auto-detect from corners)
  --bg-color2 R,G,B    Second background color (for checkerboard patterns)
  --bg-tolerance N     Color distance tolerance for background (default: 30)
  --erosion N          Erode sprite mask N iterations before labeling (default: 0)
  --cols N             Force number of columns (skip auto-detection)
  --rows N             Force number of rows (skip auto-detection)
"""

import argparse
import os
from PIL import Image
import numpy as np
from collections import deque


def detect_bg_color(arr):
    """Detect background color from image corners."""
    h, w = arr.shape[:2]
    corners = []
    for y in [0, h-1]:
        for x in [0, w-1]:
            corners.append(arr[y, x, :3].astype(float))
    return np.mean(corners, axis=0)


def make_sprite_mask(arr, bg_color, tolerance=30, bg_color2=None):
    """Create a binary mask: True where pixel differs significantly from background.
    Supports dual background colors (for checkerboard patterns)."""
    rgb = arr[:, :, :3].astype(float)
    dist = np.sqrt(np.sum((rgb - bg_color) ** 2, axis=2))
    is_bg = dist <= tolerance

    if bg_color2 is not None:
        dist2 = np.sqrt(np.sum((rgb - bg_color2) ** 2, axis=2))
        is_bg = is_bg | (dist2 <= tolerance)

    return ~is_bg


def find_period_fft(profile, min_period=50):
    """Find dominant period in a 1D profile using FFT."""
    centered = profile - profile.mean()
    fft_mag = np.abs(np.fft.rfft(centered))
    freqs = np.fft.rfftfreq(len(profile))

    # Skip frequencies corresponding to periods larger than half the signal
    min_freq_idx = max(2, int(len(profile) / (len(profile) // 2)))
    fft_mag[:min_freq_idx] = 0

    # Also skip periods shorter than min_period
    max_freq = 1.0 / min_period if min_period > 0 else 1.0
    fft_mag[freqs > max_freq] = 0

    peak_idx = np.argmax(fft_mag)
    if freqs[peak_idx] > 0:
        return round(1.0 / freqs[peak_idx])
    return None


def find_best_offset(profile, period):
    """Find the offset that places grid lines at minimum density positions."""
    best_offset = 0
    best_score = float('inf')

    for offset in range(period):
        # Sum density at all grid line positions
        positions = list(range(offset, len(profile), period))
        # Use a small window around each grid line
        score = 0
        for p in positions:
            lo = max(0, p - 3)
            hi = min(len(profile), p + 4)
            score += profile[lo:hi].sum()
        if score < best_score:
            best_score = score
            best_offset = offset

    return best_offset


def trim_cell(arr, mask, x1, y1, x2, y2, padding=2):
    """Trim a cell to its non-background content. Returns (x1,y1,x2,y2) or None."""
    cell_mask = mask[y1:y2, x1:x2]

    rows_with_content = np.any(cell_mask, axis=1)
    cols_with_content = np.any(cell_mask, axis=0)

    if not np.any(rows_with_content) or not np.any(cols_with_content):
        return None

    row_idx = np.where(rows_with_content)[0]
    col_idx = np.where(cols_with_content)[0]

    # Tight bounds
    ty1 = y1 + row_idx[0]
    ty2 = y1 + row_idx[-1] + 1
    tx1 = x1 + col_idx[0]
    tx2 = x1 + col_idx[-1] + 1

    # Add padding
    h, w = arr.shape[:2]
    tx1 = max(0, tx1 - padding)
    ty1 = max(0, ty1 - padding)
    tx2 = min(w, tx2 + padding)
    ty2 = min(h, ty2 + padding)

    return (tx1, ty1, tx2, ty2)


def split_grid(input_path, output_dir, min_size=20, padding=2,
               bg_color=None, bg_color2=None, bg_tolerance=30,
               force_cols=None, force_rows=None):
    """Split using auto-detected grid."""
    img = Image.open(input_path).convert("RGBA")
    arr = np.array(img)
    h, w = arr.shape[:2]

    print(f"Image: {os.path.basename(input_path)} ({w}x{h})")

    # Detect background
    if bg_color is None:
        bg_color = detect_bg_color(arr)
    print(f"Background color: ({bg_color[0]:.0f}, {bg_color[1]:.0f}, {bg_color[2]:.0f})")

    mask = make_sprite_mask(arr, bg_color, tolerance=bg_tolerance, bg_color2=bg_color2)
    sprite_pct = mask.sum() / mask.size * 100
    print(f"Sprite pixels: {sprite_pct:.1f}%")

    col_profile = np.sum(mask, axis=0).astype(float)
    row_profile = np.sum(mask, axis=1).astype(float)

    # Detect or use forced grid dimensions
    if force_cols:
        col_period = w // force_cols
    else:
        col_period = find_period_fft(col_profile, min_period=50)
    if force_rows:
        row_period = h // force_rows
    else:
        row_period = find_period_fft(row_profile, min_period=50)

    if col_period is None or row_period is None:
        print("Could not detect grid period. Try --mode detect or specify --cols/--rows.")
        return []

    n_cols = round(w / col_period)
    n_rows = round(h / row_period)
    print(f"Grid: {n_cols} cols (period={col_period}px) x {n_rows} rows (period={row_period}px)")

    # Find optimal offset (phase alignment)
    col_offset = find_best_offset(col_profile, col_period)
    row_offset = find_best_offset(row_profile, row_period)
    print(f"Offset: col={col_offset}, row={row_offset}")

    # Generate grid lines
    col_lines = list(range(col_offset, w + 1, col_period))
    row_lines = list(range(row_offset, h + 1, row_period))

    # Ensure we cover the full image
    if col_lines[0] > 0:
        col_lines.insert(0, 0)
    if col_lines[-1] < w:
        col_lines.append(w)
    if row_lines[0] > 0:
        row_lines.insert(0, 0)
    if row_lines[-1] < h:
        row_lines.append(h)

    os.makedirs(output_dir, exist_ok=True)
    base_name = os.path.splitext(os.path.basename(input_path))[0]
    if base_name.startswith("Gemini_Generated_Image_"):
        base_name = base_name.replace("Gemini_Generated_Image_", "")

    sprites = []
    idx = 0

    for ri in range(len(row_lines) - 1):
        for ci in range(len(col_lines) - 1):
            cy1, cy2 = row_lines[ri], row_lines[ri + 1]
            cx1, cx2 = col_lines[ci], col_lines[ci + 1]

            # Check if cell has meaningful content
            cell_mask = mask[cy1:cy2, cx1:cx2]
            content_pct = cell_mask.sum() / cell_mask.size if cell_mask.size > 0 else 0
            if content_pct < 0.05:
                continue

            # Trim to content
            trimmed = trim_cell(arr, mask, cx1, cy1, cx2, cy2, padding=padding)
            if trimmed is None:
                continue

            tx1, ty1, tx2, ty2 = trimmed
            sw, sh = tx2 - tx1, ty2 - ty1
            if sw < min_size or sh < min_size:
                continue

            # Crop and make background transparent
            sprite_img = img.crop((tx1, ty1, tx2, ty2)).copy()
            sprite_arr = np.array(sprite_img)
            sprite_mask = make_sprite_mask(sprite_arr, bg_color, tolerance=bg_tolerance,
                                          bg_color2=bg_color2)

            # Set background pixels to transparent
            sprite_arr[:, :, 3] = np.where(sprite_mask, 255, 0)
            sprite_img = Image.fromarray(sprite_arr)

            filename = f"{base_name}_{idx:03d}.png"
            filepath = os.path.join(output_dir, filename)
            sprite_img.save(filepath)

            sprites.append({
                "index": idx,
                "file": filename,
                "grid_pos": [ri, ci],
                "size": [sw, sh],
                "source_box": [tx1, ty1, tx2, ty2]
            })
            idx += 1

    write_manifest(output_dir, base_name, input_path, sprites,
                   extra=f"Grid: {n_cols}x{n_rows}, period: {col_period}x{row_period}")
    return sprites


def split_detect(input_path, output_dir, min_size=20, padding=2,
                 bg_color=None, bg_color2=None, bg_tolerance=30, erosion=0):
    """Split using connected-component detection (for irregular layouts)."""
    img = Image.open(input_path).convert("RGBA")
    arr = np.array(img)
    h, w = arr.shape[:2]

    print(f"Image: {os.path.basename(input_path)} ({w}x{h})")

    if bg_color is None:
        bg_color = detect_bg_color(arr)
    print(f"Background color: ({bg_color[0]:.0f}, {bg_color[1]:.0f}, {bg_color[2]:.0f})")
    if bg_color2 is not None:
        print(f"Background color 2: ({bg_color2[0]:.0f}, {bg_color2[1]:.0f}, {bg_color2[2]:.0f})")

    mask = make_sprite_mask(arr, bg_color, tolerance=bg_tolerance, bg_color2=bg_color2)

    from scipy.ndimage import binary_dilation, binary_erosion, label

    if erosion > 0:
        # Erode to break thin connections, then dilate to recover size
        processed = binary_erosion(mask, iterations=erosion)
        processed = binary_dilation(processed, iterations=erosion)
    else:
        # Default: dilate to connect nearby sprite pixels
        processed = binary_dilation(mask, iterations=3)

    # Label connected components
    labeled, n_features = label(processed)
    print(f"Found {n_features} connected regions")

    os.makedirs(output_dir, exist_ok=True)
    base_name = os.path.splitext(os.path.basename(input_path))[0]
    if base_name.startswith("Gemini_Generated_Image_"):
        base_name = base_name.replace("Gemini_Generated_Image_", "")

    sprites = []
    idx = 0

    for comp_id in range(1, n_features + 1):
        comp_mask = labeled == comp_id
        rows_with = np.any(comp_mask, axis=1)
        cols_with = np.any(comp_mask, axis=0)

        if not np.any(rows_with) or not np.any(cols_with):
            continue

        y1 = np.where(rows_with)[0][0]
        y2 = np.where(rows_with)[0][-1] + 1
        x1 = np.where(cols_with)[0][0]
        x2 = np.where(cols_with)[0][-1] + 1

        sw, sh = x2 - x1, y2 - y1
        if sw < min_size or sh < min_size:
            continue

        # Crop with padding
        px1 = max(0, x1 - padding)
        py1 = max(0, y1 - padding)
        px2 = min(w, x2 + padding)
        py2 = min(h, y2 + padding)

        sprite_img = img.crop((px1, py1, px2, py2)).copy()
        sprite_arr = np.array(sprite_img)
        sprite_mask = make_sprite_mask(sprite_arr, bg_color, tolerance=bg_tolerance,
                                       bg_color2=bg_color2)
        sprite_arr[:, :, 3] = np.where(sprite_mask, 255, 0)
        sprite_img = Image.fromarray(sprite_arr)

        filename = f"{base_name}_{idx:03d}.png"
        filepath = os.path.join(output_dir, filename)
        sprite_img.save(filepath)

        sprites.append({
            "index": idx,
            "file": filename,
            "size": [px2 - px1, py2 - py1],
            "source_box": [x1, y1, x2, y2]
        })
        idx += 1

    # Sort by position
    sprites.sort(key=lambda s: (s["source_box"][1] // 50, s["source_box"][0]))
    # Rename files in sorted order (use temp names to avoid collisions)
    for i, s in enumerate(sprites):
        old_path = os.path.join(output_dir, s["file"])
        tmp_path = os.path.join(output_dir, f"_tmp_{i:03d}.png")
        os.rename(old_path, tmp_path)
    for i, s in enumerate(sprites):
        tmp_path = os.path.join(output_dir, f"_tmp_{i:03d}.png")
        new_name = f"{base_name}_{i:03d}.png"
        os.rename(tmp_path, os.path.join(output_dir, new_name))
        s["file"] = new_name
        s["index"] = i

    write_manifest(output_dir, base_name, input_path, sprites, extra="Mode: detect")
    return sprites


def write_manifest(output_dir, base_name, input_path, sprites, extra=""):
    manifest_path = os.path.join(output_dir, f"manifest.txt")
    with open(manifest_path, "w") as f:
        f.write(f"Source: {os.path.basename(input_path)}\n")
        if extra:
            f.write(f"{extra}\n")
        f.write(f"Sprites extracted: {len(sprites)}\n\n")
        for entry in sprites:
            pos = entry.get("grid_pos", "")
            pos_str = f"grid=({pos[0]:2d},{pos[1]:2d})  " if pos else ""
            f.write(f"{entry['file']:30s}  {entry['size'][0]:4d}x{entry['size'][1]:<4d}  "
                    f"{pos_str}"
                    f"from ({entry['source_box'][0]}, {entry['source_box'][1]}) "
                    f"to ({entry['source_box'][2]}, {entry['source_box'][3]})\n")
    print(f"Saved {len(sprites)} sprites to {output_dir}/")
    print(f"Manifest: {manifest_path}")


def auto_detect_mode(arr, bg_color, bg_tolerance):
    """Decide whether to use grid or detect mode based on FFT analysis."""
    mask = make_sprite_mask(arr, bg_color, tolerance=bg_tolerance)
    col_profile = np.sum(mask, axis=0).astype(float)
    row_profile = np.sum(mask, axis=1).astype(float)

    col_period = find_period_fft(col_profile, min_period=50)
    row_period = find_period_fft(row_profile, min_period=50)

    if col_period and row_period:
        # Check if the periodicity is strong
        col_centered = col_profile - col_profile.mean()
        fft_mag = np.abs(np.fft.rfft(col_centered))
        peak_strength = fft_mag.max() / (fft_mag.mean() + 1e-10)

        if peak_strength > 5:
            return "grid"
    return "detect"


def main():
    parser = argparse.ArgumentParser(description="Split sprite sheets into individual sprites")
    parser.add_argument("input", help="Input sprite sheet PNG")
    parser.add_argument("output_dir", help="Output directory for extracted sprites")
    parser.add_argument("--mode", choices=["grid", "detect", "auto"], default="auto",
                        help="Split mode (default: auto)")
    parser.add_argument("--min-size", type=int, default=20,
                        help="Minimum sprite dimension (default: 20)")
    parser.add_argument("--padding", type=int, default=2,
                        help="Padding around each crop (default: 2)")
    parser.add_argument("--bg-color", type=str, default=None,
                        help="Background color as R,G,B (default: auto-detect)")
    parser.add_argument("--bg-color2", type=str, default=None,
                        help="Second background color as R,G,B (for checkerboard)")
    parser.add_argument("--bg-tolerance", type=int, default=30,
                        help="Color distance tolerance for background (default: 30)")
    parser.add_argument("--erosion", type=int, default=0,
                        help="Erode mask N iterations before labeling (default: 0)")
    parser.add_argument("--cols", type=int, default=None,
                        help="Force number of columns")
    parser.add_argument("--rows", type=int, default=None,
                        help="Force number of rows")
    args = parser.parse_args()

    bg_color = None
    if args.bg_color:
        bg_color = np.array([float(x) for x in args.bg_color.split(",")])
    bg_color2 = None
    if args.bg_color2:
        bg_color2 = np.array([float(x) for x in args.bg_color2.split(",")])

    img = Image.open(args.input).convert("RGBA")
    arr = np.array(img)

    if bg_color is None:
        bg_color = detect_bg_color(arr)

    mode = args.mode
    if mode == "auto":
        mode = auto_detect_mode(arr, bg_color, args.bg_tolerance)
        print(f"Auto-detected mode: {mode}")

    if mode == "grid":
        split_grid(args.input, args.output_dir,
                   min_size=args.min_size, padding=args.padding,
                   bg_color=bg_color, bg_color2=bg_color2,
                   bg_tolerance=args.bg_tolerance,
                   force_cols=args.cols, force_rows=args.rows)
    else:
        split_detect(args.input, args.output_dir,
                     min_size=args.min_size, padding=args.padding,
                     bg_color=bg_color, bg_color2=bg_color2,
                     bg_tolerance=args.bg_tolerance, erosion=args.erosion)


if __name__ == "__main__":
    main()
