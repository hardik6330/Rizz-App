import ExpoModulesCore
// Module.swift
// App <-> widget bridge module for @bittingz/expo-widgets.
// The plugin copies this file's contents over ExpoWidgetsModule.swift at prebuild.
// Keep the default (no app<->widget comms) unless you add native widget messaging.

public class ExpoWidgetsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoWidgets")
  }
}
