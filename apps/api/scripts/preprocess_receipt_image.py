#!/usr/bin/env python3
import sys

from PIL import Image, ImageOps


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: preprocess_receipt_image.py <input> <output>", file=sys.stderr)
        return 2

    source_path, output_path = sys.argv[1], sys.argv[2]
    with Image.open(source_path) as image:
        image = ImageOps.exif_transpose(image)
        image = ImageOps.grayscale(image)
        image = ImageOps.autocontrast(image, cutoff=1)
        image.save(output_path, format="PNG", dpi=(300, 300))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
