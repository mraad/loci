import AppKit
let size=1024
let image=NSImage(size:NSSize(width:size,height:size))
image.lockFocus()
let tile=NSBezierPath(roundedRect:NSRect(x:80,y:80,width:864,height:864),xRadius:190,yRadius:190)
NSColor(calibratedRed:0.055,green:0.10,blue:0.085,alpha:1).setFill();tile.fill()
NSGradient(starting:NSColor(calibratedRed:0.16,green:0.23,blue:0.17,alpha:1),ending:NSColor(calibratedRed:0.055,green:0.10,blue:0.085,alpha:1))!.draw(in:tile,angle:-90)
NSGraphicsContext.saveGraphicsState();tile.addClip()
for i in 0..<9 {
 let path=NSBezierPath();let rx=CGFloat(125+i*46),ry=CGFloat(69+i*34)
 for j in 0...160 {let a=Double(j)*Double.pi*2/160;let ripple=1+0.055*sin(a*3)+0.03*cos(a*5);let p=NSPoint(x:512+rx*cos(a)*ripple,y:360+ry*sin(a)*ripple);if j==0 {path.move(to:p)}else{path.line(to:p)}}
 path.close();NSColor(calibratedRed:0.60,green:0.72,blue:0.53,alpha:CGFloat(0.16+Double(i)*0.018)).setStroke();path.lineWidth=3;path.stroke()
}
let mountain=NSBezierPath();mountain.move(to:NSPoint(x:220,y:350));mountain.line(to:NSPoint(x:430,y:714));mountain.line(to:NSPoint(x:590,y:438));mountain.line(to:NSPoint(x:695,y:612));mountain.line(to:NSPoint(x:846,y:350));mountain.close()
NSColor(calibratedRed:0.72,green:0.82,blue:0.59,alpha:1).setStroke();mountain.lineWidth=18;mountain.lineJoinStyle = .round;mountain.stroke()
let ridge=NSBezierPath();ridge.move(to:NSPoint(x:350,y:350));ridge.line(to:NSPoint(x:486,y:585));ridge.move(to:NSPoint(x:543,y:350));ridge.line(to:NSPoint(x:644,y:525));ridge.lineWidth=10;NSColor(calibratedRed:0.72,green:0.82,blue:0.59,alpha:0.7).setStroke();ridge.stroke()
let dot=NSBezierPath(ovalIn:NSRect(x:673,y:728,width:30,height:30));NSColor(calibratedRed:0.84,green:0.75,blue:0.52,alpha:1).setFill();dot.fill()
NSGraphicsContext.restoreGraphicsState()
image.unlockFocus()
let bitmap=NSBitmapImageRep(data:image.tiffRepresentation!)!
try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
