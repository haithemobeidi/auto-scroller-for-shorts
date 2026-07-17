from PIL import Image, ImageDraw
import math

SIZE = 1024
CENTER = SIZE // 2
RADIUS = 460

# Brand red gradient endpoints (matches popup's #ff4444 accent, with added depth)
TOP_COLOR = (255, 107, 92)     # lighter, warmer red-orange highlight
BOTTOM_COLOR = (224, 34, 34)   # deeper red shadow

def make_base(size=SIZE):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    # Circular gradient background (diagonal top-left -> bottom-right)
    grad = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gpix = grad.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size)  # 0..1 diagonal
            r = int(TOP_COLOR[0] + (BOTTOM_COLOR[0] - TOP_COLOR[0]) * t)
            g = int(TOP_COLOR[1] + (BOTTOM_COLOR[1] - TOP_COLOR[1]) * t)
            b = int(TOP_COLOR[2] + (BOTTOM_COLOR[2] - TOP_COLOR[2]) * t)
            gpix[x, y] = (r, g, b, 255)

    mask = Image.new("L", (size, size), 0)
    mdraw = ImageDraw.Draw(mask)
    cx = cy = size // 2
    rad = int(RADIUS / SIZE * size)
    mdraw.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=255)

    img.paste(grad, (0, 0), mask)

    # Subtle inner shading: soft dark arc at the bottom for depth
    shade = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shade)
    sdraw.ellipse((cx - rad, cy - rad * 0.15, cx + rad, cy + rad * 1.6), fill=(0, 0, 0, 40))
    shade_mask = Image.new("L", (size, size), 0)
    smdraw = ImageDraw.Draw(shade_mask)
    smdraw.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=255)
    img = Image.alpha_composite(img, Image.composite(shade, Image.new("RGBA", (size, size), (0,0,0,0)), shade_mask))

    # Soft top highlight (glossy sheen)
    sheen = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shdraw = ImageDraw.Draw(sheen)
    shdraw.ellipse((cx - rad * 0.75, cy - rad * 1.05, cx + rad * 0.75, cy - rad * 0.1), fill=(255, 255, 255, 35))
    img = Image.alpha_composite(img, Image.composite(sheen, Image.new("RGBA", (size, size), (0,0,0,0)), shade_mask))

    return img


def draw_chevron(draw, cx, vy, half_w, rise, stroke, color):
    """Draw a single rounded downward chevron centered at (cx, vy) as its vertex."""
    left = (cx - half_w, vy - rise)
    right = (cx + half_w, vy - rise)
    vertex = (cx, vy)
    draw.line([left, vertex], fill=color, width=stroke)
    draw.line([vertex, right], fill=color, width=stroke)
    r = stroke / 2
    for pt in (left, vertex, right):
        draw.ellipse((pt[0] - r, pt[1] - r, pt[0] + r, pt[1] + r), fill=color)


def build_icon():
    img = make_base()
    draw = ImageDraw.Draw(img)

    white = (255, 255, 255, 255)
    half_w = 170
    rise = 120
    stroke = 66
    gap = 150  # vertical distance between the two chevrons' vertices

    top_vy = CENTER - gap / 2
    bot_vy = CENTER + gap / 2

    draw_chevron(draw, CENTER, top_vy, half_w, rise, stroke, (255, 255, 255, 210))
    draw_chevron(draw, CENTER, bot_vy, half_w, rise, stroke, white)

    return img


def export(img, path, size):
    resized = img.resize((size, size), Image.LANCZOS)
    resized.save(path)


if __name__ == "__main__":
    icon = build_icon()
    icon.save("icons_new/icon_master.png")
    for s in (128, 48, 16):
        export(icon, f"icons_new/icon{s}.png", s)
    print("done")
