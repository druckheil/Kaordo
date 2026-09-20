import AppKit
import Foundation

guard CommandLine.arguments.count == 3 else {
    fputs("usage: apply-macos-icon.swift <app-path> <icns-path>\n", stderr)
    exit(EXIT_FAILURE)
}

let appPath = CommandLine.arguments[1]
let iconPath = CommandLine.arguments[2]

guard FileManager.default.fileExists(atPath: appPath) else {
    fputs("application not found: \(appPath)\n", stderr)
    exit(EXIT_FAILURE)
}

guard let icon = NSImage(contentsOfFile: iconPath) else {
    fputs("icon could not be loaded: \(iconPath)\n", stderr)
    exit(EXIT_FAILURE)
}

guard NSWorkspace.shared.setIcon(icon, forFile: appPath, options: []) else {
    fputs("could not assign the custom Finder icon: \(appPath)\n", stderr)
    exit(EXIT_FAILURE)
}
