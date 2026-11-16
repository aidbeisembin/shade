// Делает иконку трея macOS (template image) из логотипа frontend/public/brand/shade.svg.
// Запуск: swift scripts/make-tray-icon.swift
// Результат: frontend/src-tauri/icons/tray-template.rgba (64x64, сырые байты RGBA, чёрный силуэт, глаза и искра прозрачные)
//            frontend/src-tauri/icons/tray-template.png (то же для просмотра, в сборку не входит)
import AppKit

let root = FileManager.default.currentDirectoryPath
let svgPath = "\(root)/frontend/public/brand/shade.svg"
let outDir = "\(root)/frontend/src-tauri/icons"
let size = 64
let work = 1024 // рендер крупно, потом уменьшение

guard var svg = try? String(contentsOfFile: svgPath, encoding: .utf8) else { fatalError("нет \(svgPath)") }
// Убираем фон-квадрат: остаётся только силуэт с глазами и искрой.
let rectRange = svg.range(of: #"<rect[^>]*/>"#, options: .regularExpression)!
svg.removeSubrange(rectRange)

guard let image = NSImage(data: svg.data(using: .utf8)!) else { fatalError("SVG не прочитан") }

func bitmap(_ w: Int, _ h: Int) -> NSBitmapImageRep {
    NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8,
                     samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                     colorSpaceName: .deviceRGB, bytesPerRow: w * 4, bitsPerPixel: 32)!
}

// 1. Рендер SVG без фона.
let big = bitmap(work, work)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: big)
NSGraphicsContext.current?.imageInterpolation = .high
image.draw(in: NSRect(x: 0, y: 0, width: work, height: work))
NSGraphicsContext.restoreGraphicsState()

// 2. Силуэт: чёрное остаётся непрозрачным, светлое (глаза, искра) становится дырой.
let p = big.bitmapData!
var minX = work, minY = work, maxX = 0, maxY = 0
var mask = [UInt8](repeating: 0, count: work * work)
for y in 0..<work {
    for x in 0..<work {
        let i = (y * work + x) * 4
        let a = Double(p[i + 3]) / 255
        if a == 0 { continue }
        // bitmap без предумножения: цвет в p[i...i+2]
        let lum = (0.2126 * Double(p[i]) + 0.7152 * Double(p[i + 1]) + 0.0722 * Double(p[i + 2])) / 255
        let k = 1 - min(max((lum - 0.1) / 0.7, 0), 1)
        let v = UInt8((a * k * 255).rounded())
        mask[y * work + x] = v
        if v > 8 { minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y) }
    }
}

// 3. Квадрат вокруг силуэта с небольшим полем, уменьшение до size x size (усреднение).
let side = Double(max(maxX - minX, maxY - minY) + 1)
let pad = side * 0.04
let box = side + pad * 2
let cx = Double(minX + maxX) / 2, cy = Double(minY + maxY) / 2
let x0 = cx - box / 2, y0 = cy - box / 2
let out = bitmap(size, size)
let o = out.bitmapData!
let cell = box / Double(size)
for y in 0..<size {
    for x in 0..<size {
        var sum = 0.0, n = 0.0
        let sx0 = x0 + Double(x) * cell, sy0 = y0 + Double(y) * cell
        let ix0 = Int(sx0.rounded(.down)), iy0 = Int(sy0.rounded(.down))
        let ix1 = Int((sx0 + cell).rounded(.up)), iy1 = Int((sy0 + cell).rounded(.up))
        for yy in iy0..<iy1 { for xx in ix0..<ix1 {
            n += 1
            if xx >= 0 && xx < work && yy >= 0 && yy < work { sum += Double(mask[yy * work + xx]) }
        } }
        let i = (y * size + x) * 4
        o[i] = 0; o[i + 1] = 0; o[i + 2] = 0
        o[i + 3] = UInt8(min(255, (sum / max(n, 1)).rounded()))
    }
}

try! Data(bytes: o, count: size * size * 4).write(to: URL(fileURLWithPath: "\(outDir)/tray-template.rgba"))
try! out.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(outDir)/tray-template.png"))
print("готово: \(size)x\(size)")
