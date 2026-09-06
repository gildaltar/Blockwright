import { describe, expect, it } from "vitest";
import {
  componentCanResizeExactly,
  componentCanRotateOrMirrorExactly,
  componentUsesProceduralGeometry,
  rotateBoundsY,
  translateDesignElement,
  translateTemplateInstance,
} from "./editor-geometry.js";

describe("editor procedural transform guard", () => {
  const design = {
    elements: [
      { id: "legacy-box", kind: "fill" },
      { id: "nested-roof", kind: "procedural" },
    ],
    templates: [{ id: "roof-template", elementIds: ["nested-roof"] }],
  };

  it("detects procedural geometry owned directly or through a template", () => {
    expect(componentUsesProceduralGeometry({ elementIds: ["nested-roof"] }, design)).toBe(true);
    expect(componentUsesProceduralGeometry({ elementIds: [], templateInstances: [{ templateId: "roof-template" }] }, design)).toBe(true);
    expect(componentUsesProceduralGeometry({ elementIds: ["legacy-box"] }, design)).toBe(false);
    expect(componentCanResizeExactly({ elementIds: ["legacy-box"] }, design)).toBe(true);
    expect(componentCanResizeExactly({ elementIds: ["nested-roof"] }, design)).toBe(false);
    expect(componentCanRotateOrMirrorExactly({ elementIds: [], templateInstances: [{ templateId: "roof-template" }] }, design)).toBe(false);
    expect(rotateBoundsY({ min: { x: 0, y: 2, z: 0 }, max: { x: 2, y: 6, z: 4 } }, 90)).toEqual({
      min: { x: -1, y: 2, z: 1 },
      max: { x: 3, y: 6, z: 3 },
    });
  });

  it("translates nested paths, clips, masks, and terrain height fields together", () => {
    const terrain = {
      primitive: { type: "terrain_surface", min: { x: 1, y: 2, z: 3 }, max: { x: 4, y: 5, z: 6 }, baseY: 2, fillToY: 0 },
      clip: { min: { x: 1, y: 0, z: 1 }, max: { x: 4, y: 5, z: 4 } },
      masks: [{ primitive: { type: "polygon", points: [{ x: 1, y: 2, z: 3 }, { x: 2, y: 2, z: 3 }, { x: 1, y: 2, z: 4 }] } }],
    };
    translateDesignElement(terrain, { x: 10, y: 4, z: -2 });
    expect(terrain).toMatchObject({
      primitive: { min: { x: 11, y: 6, z: 1 }, max: { x: 14, y: 9, z: 4 }, baseY: 6, fillToY: 4 },
      clip: { min: { x: 11, y: 4, z: -1 }, max: { x: 14, y: 9, z: 2 } },
      masks: [{ primitive: { points: [{ x: 11, y: 6, z: 1 }, { x: 12, y: 6, z: 1 }, { x: 11, y: 6, z: 2 }] } }],
    });

    const swept = { primitive: { type: "profile_extrusion", profile: { plane: "xy", points: [{ u: 0, v: 0 }] }, path: [{ x: 0, y: 1, z: 2 }, { x: 3, y: 4, z: 5 }] } };
    translateDesignElement(swept, { x: 2, y: 3, z: 4 });
    expect(swept.primitive.path).toEqual([{ x: 2, y: 4, z: 6 }, { x: 5, y: 7, z: 9 }]);

    const legacyVerticals = { liquidLevel: 5, supports: { toY: -2 } };
    translateDesignElement(legacyVerticals, { x: 0, y: 6, z: 0 });
    expect(legacyVerticals).toEqual({ liquidLevel: 11, supports: { toY: 4 } });

    const mirroredInstance = { repetition: { kind: "mirrored", axis: "x", coordinate: 7 } };
    translateTemplateInstance(mirroredInstance, { x: 2, y: 1, z: -3 });
    expect(mirroredInstance).toEqual({ origin: { x: 2, y: 1, z: -3 }, repetition: { kind: "mirrored", axis: "x", coordinate: 9 } });
  });
});
