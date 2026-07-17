from PIL import Image, ImageFilter, ImageDraw, ImageFont

CANVAS_W, CANVAS_H = 1280, 800
BG_COLOR = (15, 15, 15)

RAW_PATH = r"C:\Users\haith\AppData\Local\Temp\claude-chrome-screenshots-Eypg3j\screenshot-1784322815769-1.png"
POPUP_PATH = r"C:\Users\haith\OneDrive\Pictures\Screenshots\shortsautoscroll.png"
OUT_PATH = "store-assets/screenshot-1-1280x800.png"

# Video player crop, measured directly from the raw screenshot, cut just above the
# caption band so no caption text is included.
VIDEO_BOX = (20, 32, 478, 605)


def make_badge(text="12s", scale=3):
    """Render the on-page countdown badge from scratch (matches content.css's
    .yt-as-badge exactly) instead of cropping it out of the page screenshot,
    which drags in YouTube's own adjacent UI chrome."""
    h = 40 * scale
    pad_x = 14 * scale
    icon_size = 11 * scale
    gap = 6 * scale
    font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 15 * scale)

    tmp = Image.new("RGBA", (1, 1))
    tw = ImageDraw.Draw(tmp).textlength(text, font=font)

    w = int(pad_x * 2 + icon_size + gap + tw)
    badge = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(badge)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=h // 2, fill=(255, 68, 68, 230))

    cx = pad_x
    cy = h / 2
    d.polygon(
        [(cx, cy - icon_size / 2), (cx, cy + icon_size / 2), (cx + icon_size * 0.9, cy)],
        fill=(255, 255, 255, 255),
    )
    d.text((cx + icon_size + gap, cy), text, font=font, fill=(255, 255, 255, 255), anchor="lm")

    return badge


def rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def drop_shadow(canvas_size, box, mask, blur=22, opacity=170, offset=(10, 14)):
    shadow = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    shape = Image.new("RGBA", (box[2] - box[0], box[3] - box[1]), (0, 0, 0, opacity))
    shape.putalpha(mask.point(lambda a: int(a * opacity / 255)))
    shadow.paste(shape, (box[0] + offset[0], box[1] + offset[1]), shape)
    return shadow.filter(ImageFilter.GaussianBlur(blur))


def main():
    raw = Image.open(RAW_PATH).convert("RGB")

    video = raw.crop(VIDEO_BOX)
    v_scale = 1.25
    video = video.resize((int(video.width * v_scale), int(video.height * v_scale)), Image.LANCZOS)
    v_mask = rounded_mask(video.size, 14)

    badge = make_badge("12s", scale=2)
    b_mask = rounded_mask(badge.size, badge.height // 2)

    popup = Image.open(POPUP_PATH).convert("RGBA")
    p_scale = 1.35
    popup = popup.resize((int(popup.width * p_scale), int(popup.height * p_scale)), Image.LANCZOS)
    p_mask = rounded_mask(popup.size, 18)
    popup.putalpha(p_mask)

    # --- layout ---
    v_left, v_top = 70, (CANVAS_H - video.height) // 2
    p_left, p_top = CANVAS_W - popup.width - 80, (CANVAS_H - popup.height) // 2
    b_left = v_left + video.width - badge.width - 16
    b_top = v_top + 16

    canvas = Image.new("RGBA", (CANVAS_W, CANVAS_H), BG_COLOR + (255,))

    v_box_abs = (v_left, v_top, v_left + video.width, v_top + video.height)
    p_box_abs = (p_left, p_top, p_left + popup.width, p_top + popup.height)

    canvas = Image.alpha_composite(canvas, drop_shadow(canvas.size, v_box_abs, v_mask))
    canvas = Image.alpha_composite(canvas, drop_shadow(canvas.size, p_box_abs, p_mask))

    video_rgba = video.convert("RGBA")
    video_rgba.putalpha(v_mask)
    canvas.paste(video_rgba, (v_left, v_top), video_rgba)
    canvas.paste(popup, (p_left, p_top), popup)

    badge_rgba = badge.convert("RGBA")
    badge_rgba.putalpha(b_mask)
    canvas.paste(badge_rgba, (b_left, b_top), badge_rgba)

    final = canvas.convert("RGB")
    final.save(OUT_PATH)
    print("saved", OUT_PATH, final.size, final.mode)


if __name__ == "__main__":
    main()
