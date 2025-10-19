from PIL import Image, ImageDraw, ImageFont

# Create 128x128 image with high quality
img = Image.new('RGB', (128, 128), color='#2C6496')
draw = ImageDraw.Draw(img)

# Define grid cell dimensions - larger cells, better proportions
padding = 12
cell_size = 50
gap = 4

# Terminal background color (darker for more contrast)
terminal_bg = '#0E1419'
terminal_fg = '#39C6C0'

# Draw grid cells with rounded corners
def draw_rounded_rect(draw, xy, radius, fill):
    x1, y1, x2, y2 = xy
    draw.rectangle([x1 + radius, y1, x2 - radius, y2], fill=fill)
    draw.rectangle([x1, y1 + radius, x2, y2 - radius], fill=fill)
    draw.pieslice([x1, y1, x1 + radius * 2, y1 + radius * 2], 180, 270, fill=fill)
    draw.pieslice([x2 - radius * 2, y1, x2, y1 + radius * 2], 270, 360, fill=fill)
    draw.pieslice([x1, y2 - radius * 2, x1 + radius * 2, y2], 90, 180, fill=fill)
    draw.pieslice([x2 - radius * 2, y2 - radius * 2, x2, y2], 0, 90, fill=fill)

# Grid positions (2x2)
positions = [
    (padding, padding),  # Top-left
    (padding + cell_size + gap, padding),  # Top-right
    (padding, padding + cell_size + gap),  # Bottom-left
    (padding + cell_size + gap, padding + cell_size + gap)  # Bottom-right
]

# Draw terminal cells with subtle shadow
for x, y in positions:
    # Shadow for depth
    draw_rounded_rect(draw, (x + 2, y + 2, x + cell_size + 2, y + cell_size + 2), 6, '#00000040')
    # Main cell
    draw_rounded_rect(draw, (x, y, x + cell_size, y + cell_size), 6, terminal_bg)

# Load font for terminal prompts (>) - much larger and bolder
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Courier New Bold.ttf", 48)
except:
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Courier.dfont", 48)
    except:
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", 48)
        except:
            font = ImageFont.load_default()

# Draw > symbols - centered and larger
for x, y in positions:
    text = ">"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    text_x = x + (cell_size - text_width) // 2 - 2
    text_y = y + (cell_size - text_height) // 2 - 6

    draw.text((text_x, text_y), text, fill=terminal_fg, font=font)

# Save as PNG
img.save('icon.png')
print("Icon created: icon.png")
