from PIL import Image, ImageDraw, ImageFont

# Create 128x128 image
img = Image.new('RGB', (128, 128), color='#2C6496')
draw = ImageDraw.Draw(img)

# Define grid cell dimensions
padding = 16
cell_size = 44
gap = 8

# Terminal background color
terminal_bg = '#1E1E1E'
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

# Draw terminal cells
for x, y in positions:
    draw_rounded_rect(draw, (x, y, x + cell_size, y + cell_size), 4, terminal_bg)

# Load font for terminal prompts (>)
try:
    font = ImageFont.truetype("/System/Library/Fonts/Courier.dfont", 32)
except:
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 32)
    except:
        font = ImageFont.load_default()

# Draw > symbols
for x, y in positions:
    draw.text((x + 10, y + 10), ">", fill=terminal_fg, font=font)

# Save as PNG
img.save('icon.png')
print("Icon created: icon.png")
