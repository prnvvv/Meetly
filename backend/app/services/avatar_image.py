"""Validate and normalise an uploaded avatar.

The browser-supplied MIME type and file name are never trusted: the bytes are
decoded with Pillow, the real format must be PNG/JPEG/WebP, dimensions are
bounded (decompression-bomb guard), and the image is re-encoded as a 512x512
WebP, which also strips EXIF/GPS and any appended payload.
"""

from __future__ import annotations

import io

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 2 * 1024 * 1024
MAX_SOURCE_PIXELS = 25_000_000
MAX_SOURCE_SIDE = 8000
MIN_SIDE = 64
OUTPUT_SIDE = 512
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}

Image.MAX_IMAGE_PIXELS = MAX_SOURCE_PIXELS


class InvalidImageError(ValueError):
    """The upload is not an acceptable image (message is safe to show a user)."""


def normalise_avatar(data: bytes) -> bytes:
    if not data:
        raise InvalidImageError("No image was uploaded")
    if len(data) > MAX_UPLOAD_BYTES:
        raise InvalidImageError("Image is too large (maximum 2 MB)")
    try:
        probe = Image.open(io.BytesIO(data))
        fmt = probe.format
        probe.verify()
        image = Image.open(io.BytesIO(data))
        image.load()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, ValueError):
        raise InvalidImageError("That file is not a valid image") from None
    if fmt not in ALLOWED_FORMATS:
        raise InvalidImageError("Use a PNG, JPEG or WebP image")
    width, height = image.size
    if width > MAX_SOURCE_SIDE or height > MAX_SOURCE_SIDE:
        raise InvalidImageError("Image dimensions are too large")
    if width < MIN_SIDE or height < MIN_SIDE:
        raise InvalidImageError(f"Image must be at least {MIN_SIDE}x{MIN_SIDE} pixels")
    image = ImageOps.exif_transpose(image)
    image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
    image = ImageOps.fit(image, (OUTPUT_SIDE, OUTPUT_SIDE), method=Image.Resampling.LANCZOS)
    out = io.BytesIO()
    image.save(out, format="WEBP", quality=85, method=4)
    return out.getvalue()
