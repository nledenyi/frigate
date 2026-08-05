import type { SectionConfigOverrides } from "./types";

const birdseye: SectionConfigOverrides = {
  base: {
    sectionDocs: "/configuration/birdseye",
    messages: [
      {
        key: "objects-mode-detect-disabled",
        messageKey: "configMessages.birdseye.objectsModeDetectDisabled",
        severity: "info",
        condition: (ctx) => {
          if (ctx.level !== "camera" || !ctx.fullCameraConfig) return false;
          return (
            ctx.formData?.mode === "objects" &&
            ctx.fullCameraConfig.detect?.enabled === false
          );
        },
      },
    ],
    restartRequired: [],
    fieldOrder: ["enabled", "mode", "order"],
    hiddenFields: ["order"],
    advancedFields: [],
    overrideFields: ["enabled", "mode"],
    uiSchema: {
      mode: {
        "ui:size": "xs",
        "ui:options": {
          enumI18nPrefix: "birdseye.trackingMode",
        },
      },
      // placement is painted on the grid in the global Birdseye settings, the
      // same way the camera order is, so the values behind it are kept but
      // not shown as fields.
      //
      // Deliberately not hiddenFields, which the order above does use:
      // sanitizeSectionData unsets a hidden field, which is right for a value
      // nothing in this section writes, and wrong here, since a save would
      // then drop the placement that was just painted.
      cell: {
        "ui:widget": "hidden",
      },
      span: {
        "ui:widget": "hidden",
      },
    },
  },
  global: {
    fieldOrder: [
      "enabled",
      "restream",
      "width",
      "height",
      "quality",
      "mode",
      "layout",
      "inactivity_threshold",
      "idle_heartbeat_fps",
    ],
    advancedFields: ["width", "height", "quality", "inactivity_threshold"],
    restartRequired: [
      "enabled",
      "restream",
      "width",
      "height",
      "quality",
      "idle_heartbeat_fps",
    ],
    uiSchema: {
      mode: {
        "ui:size": "xs",
        "ui:after": { render: "BirdseyeCameraReorder" },
      },
      layout: {
        mode: {
          "ui:size": "xs",
          "ui:options": {
            enumI18nPrefix: "birdseye.layoutMode",
          },
          "ui:after": { render: "BirdseyeLayoutBuilder" },
        },
      },
      // the grid behind these is painted by BirdseyeLayoutBuilder
      "layout.cols": {
        "ui:widget": "hidden",
      },
      "layout.rows": {
        "ui:widget": "hidden",
      },
      "layout.layouts": {
        "ui:widget": "hidden",
      },
    },
  },
};

export default birdseye;
