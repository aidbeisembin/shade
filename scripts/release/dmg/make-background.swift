// Фон окна Shade_aarch64.dmg: что делать после открытия образа, по-русски и по-английски.
// Запуск из корня репозитория: swift scripts/release/dmg/make-background.swift
// Результат: scripts/release/dmg/background.png, 2x (1360x960 px, 144 dpi, в окне 680x480 pt).
// Раскладка окна (размер, места значков) в release.yml, шаг Build, ключ bundle.macOS.dmg; координаты
// ниже с ней совпадают: Shade в (170, 120), «Программы» в (510, 120), значки 128 pt.
// Видно только верхние 420 pt: из 480 pt окна Finder отдаёт около 32 pt заголовку и 28 pt строке пути
// (она видна, если у человека включено «Показать строку пути»). Всё содержимое выше 410 pt.
// Цвет подписей под значками Finder подбирает сам по яркости картинки.
import AppKit

let W: CGFloat = 680, H: CGFloat = 480, scale: CGFloat = 2
let root = FileManager.default.currentDirectoryPath
// Тёмный по умолчанию: Finder не меняет фон окна по теме системы (проверено: прозрачный PNG
// даёт белое, HEIC со светлым и тёмным вариантом показывает светлый). DMG_LIGHT=1 рисует светлый.
let dark = ProcessInfo.processInfo.environment["DMG_LIGHT"] != "1"
let out = ProcessInfo.processInfo.environment["DMG_OUT"] ?? "\(root)/scripts/release/dmg/background.png"

let bg = dark ? NSColor(srgbRed: 0.067, green: 0.067, blue: 0.067, alpha: 1) : NSColor(srgbRed: 0.957, green: 0.957, blue: 0.949, alpha: 1)
let ink = dark ? NSColor.white : NSColor(srgbRed: 0.067, green: 0.067, blue: 0.067, alpha: 1)  // #111
let muted = dark ? NSColor(white: 0.66, alpha: 1) : NSColor(srgbRed: 0.33, green: 0.33, blue: 0.33, alpha: 1)   // #545454, 7.4:1 на фоне
let lime = NSColor(srgbRed: 0.875, green: 0.98, blue: 0.443, alpha: 1)  // --primary, лайм Shade
let card = dark ? NSColor(white: 0.12, alpha: 1) : NSColor.white
let line = dark ? NSColor(white: 0.2, alpha: 1) : NSColor(srgbRed: 0.88, green: 0.88, blue: 0.87, alpha: 1)

let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(W * scale), pixelsHigh: Int(H * scale),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: W, height: H) // 144 dpi: Finder рисует картинку в 680x480 pt
NSGraphicsContext.saveGraphicsState()
let ctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = ctx
// Координаты сверху вниз, как в Finder
ctx.cgContext.translateBy(x: 0, y: H)
ctx.cgContext.scaleBy(x: 1, y: -1)

bg.setFill()
NSRect(x: 0, y: 0, width: W, height: H).fill()

func font(_ size: CGFloat, _ weight: NSFont.Weight) -> NSFont { .systemFont(ofSize: size, weight: weight) }
func mono(_ size: CGFloat) -> NSFont { .monospacedSystemFont(ofSize: size, weight: .medium) }

// Строка с шагами пути: вместо стрелок шевроны «›», жирные и серые, как в приложении
func path(_ s: String, _ f: NSFont, _ c: NSColor) -> NSAttributedString {
    let out = NSMutableAttributedString()
    let chevron: [NSAttributedString.Key: Any] = [.font: font(f.pointSize, .bold), .foregroundColor: muted]
    for (i, part) in s.components(separatedBy: " › ").enumerated() {
        if i > 0 { out.append(NSAttributedString(string: "  ›  ", attributes: chevron)) }
        out.append(NSAttributedString(string: part, attributes: [.font: f, .foregroundColor: c]))
    }
    return out
}

// Текст по центру x (или от левого края, если center: false), y: верх строки
@discardableResult
func text(_ s: String, _ f: NSFont, _ c: NSColor, x: CGFloat, y: CGFloat, center: Bool = true) -> CGFloat {
    draw(NSAttributedString(string: s, attributes: [.font: f, .foregroundColor: c]), x: x, y: y, center: center)
}

@discardableResult
func draw(_ str: NSAttributedString, x: CGFloat, y: CGFloat, center: Bool = true) -> CGFloat {
    let size = str.size()
    NSGraphicsContext.saveGraphicsState()
    // NSString рисует в неперевёрнутой системе: переворачиваем обратно вокруг строки
    let t = NSAffineTransform()
    t.translateX(by: 0, yBy: y + size.height)
    t.scaleX(by: 1, yBy: -1)
    t.concat()
    str.draw(at: NSPoint(x: center ? x - size.width / 2 : x, y: 0))
    NSGraphicsContext.restoreGraphicsState()
    return size.width
}

func width(_ s: String, _ f: NSFont) -> CGFloat { NSAttributedString(string: s, attributes: [.font: f]).size().width }

// 1. Перетащить: стрелка между значками и подпись над ней
let arrowY: CGFloat = 120
let a = NSBezierPath()
a.lineWidth = 6
a.lineCapStyle = .round
a.lineJoinStyle = .round
a.move(to: NSPoint(x: 268, y: arrowY))
a.line(to: NSPoint(x: 410, y: arrowY))
a.move(to: NSPoint(x: 392, y: arrowY - 16))
a.line(to: NSPoint(x: 412, y: arrowY))
a.line(to: NSPoint(x: 392, y: arrowY + 16))
ink.setStroke()
a.stroke()
text("Перетащите", font(17, .bold), ink, x: 340, y: 46)
text("в Программы", font(17, .bold), ink, x: 340, y: 66)
text("Drag to Applications", font(13, .medium), muted, x: 340, y: 146)

// 2. Первый запуск: плитка с путём в Системных настройках
let cardRect = NSRect(x: 28, y: 224, width: W - 56, height: 114)
card.setFill()
NSBezierPath(roundedRect: cardRect, xRadius: 14, yRadius: 14).fill()
line.setStroke()
let border = NSBezierPath(roundedRect: cardRect.insetBy(dx: 0.5, dy: 0.5), xRadius: 14, yRadius: 14)
border.lineWidth = 1
border.stroke()

let pillText = "Первый запуск · First launch"
let pillFont = font(13, .semibold)
let pillW = width(pillText, pillFont) + 24
let pill = NSRect(x: cardRect.minX + 20, y: cardRect.minY + 16, width: pillW, height: 24)
lime.setFill()
NSBezierPath(roundedRect: pill, xRadius: 12, yRadius: 12).fill()
text(pillText, pillFont, NSColor(srgbRed: 0.067, green: 0.067, blue: 0.067, alpha: 1), x: pill.midX, y: pill.minY + 4)

let left = cardRect.minX + 20
draw(path("Системные настройки › Конфиденциальность", font(17, .semibold), ink), x: left, y: cardRect.minY + 46, center: false)
draw(path("и безопасность › «Всё равно открыть»", font(17, .semibold), ink), x: left, y: cardRect.minY + 68, center: false)
draw(path("System Settings › Privacy & Security › Open Anyway", font(13, .medium), muted), x: left, y: cardRect.minY + 90, center: false)

// 3. Запасной путь мелко: что делать, если кнопки нет
let y3 = cardRect.maxY + 10
text("Кнопки «Всё равно открыть» нет? Выполните в Терминале:", font(12, .medium), muted, x: W / 2, y: y3)
text("No “Open Anyway” button? Run in Terminal:", font(11, .regular), muted, x: W / 2, y: y3 + 17)
text("xattr -cr /Applications/Shade.app", mono(13), ink, x: W / 2, y: y3 + 36)

NSGraphicsContext.restoreGraphicsState()
guard let png = rep.representation(using: .png, properties: [:]) else { fatalError("PNG не записан") }
try! png.write(to: URL(fileURLWithPath: out))
print("\(out): \(rep.pixelsWide)x\(rep.pixelsHigh) px, \(Int(W))x\(Int(H)) pt")
