import type { StyleSpecification } from "maplibre-gl";

const EARTH_DEMO_STYLE_URL = "https://demotiles.maplibre.org/style.json";
const DEMOTILES_GLYPHS = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";

// Raster-dem source id wired up by GlobeApp.setTerrain3D. The bundled
// Golarion style serves Terrarium-encoded PNG tiles synthesized offline from
// pf-wikis biome polygons + mountain labels. Custom user styles can wire
// their own source under the same id to participate in the toggle.
export const DEM_SOURCE_ID = "dem";

/**
 * MapLibre style for the bundled Golarion pmtiles.
 *
 * Important: the pmtiles encoded by the pf-wikis pipeline carry per-feature
 * styling fields directly in their vector data:
 *   - geometry.color         (hex string)        -> fill-color
 *   - line-labels.color/halo (hex strings)       -> text-color/halo
 *   - labels.angle/color/halo/type
 *   - borders.borderType     (number)            -> line-width tier
 *   - locations.icon/label/link/text/filter*     (per-location wiki info)
 *
 * We just plug those into MapLibre expressions so the data drives the look,
 * matching the original pf-wikis palette without us inventing one.
 */
function golarionStyle(pmtilesUrl: string, terrainTilesUrl: string): StyleSpecification {
  const labelHaloDefault = "rgba(255, 248, 230, 0.9)";
  return {
    version: 8,
    name: "Golarion",
    glyphs: DEMOTILES_GLYPHS,
    // MapLibre v5 globe projection: 3D sphere at low zoom, smoothly morphs
    // to mercator around zoom 5-6 and stays flat at high zoom.
    projection: { type: "globe" },
    sky: {
      "sky-color": "#152034",
      "horizon-color": "#3a5577",
      "fog-color": "#a4b8d4",
      "fog-ground-blend": 0.55,
      "horizon-fog-blend": 0.4,
      "sky-horizon-blend": 0.6,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 0.5, 7, 0],
    },
    sources: {
      g: {
        type: "vector",
        url: `pmtiles://${pmtilesUrl}`,
        attribution:
          'Map and location data via the <a href="https://github.com/pf-wikis/mapping">pf-wikis mapping project</a> &amp; <a href="https://pathfinderwiki.com">PathfinderWiki</a> (CC BY-SA 3.0). Pathfinder, Golarion, and related marks are trademarks of Paizo Inc., used under Paizo\'s <a href="https://paizo.com/licenses/communityuse">Community Use Policy</a>.',
      },
      [DEM_SOURCE_ID]: {
        type: "raster-dem",
        encoding: "terrarium",
        tiles: [terrainTilesUrl],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 5,
      },
    },
    layers: [
      // Ocean / void
      { id: "bg", type: "background", paint: { "background-color": "#9cbed4" } },

      // Land + water polygons. The data carries its own colors (sea, lakes,
      // deserts, forests, hills, mountains, etc.), so we just read them.
      {
        id: "geom",
        type: "fill",
        source: "g",
        "source-layer": "geometry",
        paint: {
          "fill-color": ["coalesce", ["get", "color"], "#cdbc8e"],
          "fill-antialias": true,
        },
      },

      // Hillshade driven by the same dem source. Renders shaded relief on
      // top of the colored biome fills so mountains read visually even
      // when terrain mode is off. With setTerrain on, the hillshade is
      // draped onto the 3D surface for compounding effect.
      {
        id: "hillshade",
        type: "hillshade",
        source: DEM_SOURCE_ID,
        paint: {
          "hillshade-exaggeration": 0.55,
          "hillshade-shadow-color": "#3a2914",
          "hillshade-highlight-color": "#fff8e6",
          "hillshade-accent-color": "#7a5a32",
          "hillshade-illumination-direction": 315,
          "hillshade-illumination-anchor": "viewport",
        },
      },

      // Political/regional borders, three tiers as separate layers because
      // MapLibre does not allow data expressions for line-dasharray.
      {
        id: "borders-1",
        type: "line",
        source: "g",
        "source-layer": "borders",
        filter: ["==", ["to-number", ["get", "borderType"]], 1],
        paint: {
          "line-color": "rgba(40, 25, 10, 0.75)",
          "line-width": 1.6,
          "line-dasharray": [4, 2],
        },
      },
      {
        id: "borders-2",
        type: "line",
        source: "g",
        "source-layer": "borders",
        filter: ["==", ["to-number", ["get", "borderType"]], 2],
        paint: {
          "line-color": "rgba(40, 25, 10, 0.65)",
          "line-width": 1.0,
          "line-dasharray": [3, 1.5],
        },
      },
      {
        id: "borders-3",
        type: "line",
        source: "g",
        "source-layer": "borders",
        filter: ["==", ["to-number", ["get", "borderType"]], 3],
        paint: {
          "line-color": "rgba(40, 25, 10, 0.55)",
          "line-width": 0.6,
          "line-dasharray": [1, 1.5],
        },
      },

      // Line labels (rivers, ranges, coastlines). Color + halo come from data.
      {
        id: "line-labels",
        type: "symbol",
        source: "g",
        "source-layer": "line-labels",
        minzoom: 3,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Semibold"],
          "text-size": 11,
          "symbol-placement": "line",
          "text-letter-spacing": 0.05,
        },
        paint: {
          "text-color": ["coalesce", ["get", "color"], "#3a2a14"],
          "text-halo-color": ["coalesce", ["get", "halo"], labelHaloDefault],
          "text-halo-width": 1,
        },
      },

      // Generic labels (forests, mountains, lakes, deserts). Angle + colors from data.
      {
        id: "labels-misc",
        type: "symbol",
        source: "g",
        "source-layer": "labels",
        minzoom: 4,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Semibold"],
          "text-size": 12,
          "text-rotate": ["coalesce", ["get", "angle"], 0],
          "text-letter-spacing": 0.04,
        },
        paint: {
          "text-color": ["coalesce", ["get", "color"], "#3a2a14"],
          "text-halo-color": ["coalesce", ["get", "halo"], labelHaloDefault],
          "text-halo-width": 1,
        },
      },

      // Location markers. Could later switch to icon-image once we ship the
      // sprite sheet; for now circles keep things lightweight.
      {
        id: "locations-dot",
        type: "circle",
        source: "g",
        "source-layer": "locations",
        minzoom: 3,
        paint: {
          "circle-color": "#8a1f10",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2.5, 8, 5.5],
          "circle-stroke-color": "#fff8e6",
          "circle-stroke-width": 1,
        },
      },
      {
        id: "locations-label",
        type: "symbol",
        source: "g",
        "source-layer": "locations",
        minzoom: 5,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Semibold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 5, 10, 9, 13],
          "text-offset": [0, 0.9],
          "text-anchor": "top",
          "text-optional": true,
        },
        paint: {
          "text-color": "#2a1908",
          "text-halo-color": labelHaloDefault,
          "text-halo-width": 1.2,
        },
      },

      // Subregion labels
      {
        id: "subregion-labels",
        type: "symbol",
        source: "g",
        "source-layer": "subregion-labels",
        minzoom: 5,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Semibold"],
          "text-size": 11,
          "text-rotate": ["coalesce", ["get", "angle"], 0],
          "text-letter-spacing": 0.05,
        },
        paint: {
          "text-color": "#4a3520",
          "text-halo-color": labelHaloDefault,
          "text-halo-width": 1,
        },
      },

      // Province labels
      {
        id: "province-labels",
        type: "symbol",
        source: "g",
        "source-layer": "province-labels",
        minzoom: 4,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Semibold"],
          "text-size": 12,
          "text-rotate": ["coalesce", ["get", "angle"], 0],
          "text-letter-spacing": 0.08,
        },
        paint: {
          "text-color": "#3d2a14",
          "text-halo-color": labelHaloDefault,
          "text-halo-width": 1.2,
        },
      },

      // Region labels: prominent at mid-zoom
      {
        id: "region-labels",
        type: "symbol",
        source: "g",
        "source-layer": "region-labels",
        minzoom: 3,
        maxzoom: 8,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Semibold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 12, 6, 16],
          "text-rotate": ["coalesce", ["get", "angle"], 0],
          "text-letter-spacing": 0.12,
          "text-transform": "uppercase",
        },
        paint: {
          "text-color": "#2a1908",
          "text-halo-color": labelHaloDefault,
          "text-halo-width": 1.4,
        },
      },

      // Nation labels: most prominent, low zoom only
      {
        id: "nation-labels",
        type: "symbol",
        source: "g",
        "source-layer": "nation-labels",
        minzoom: 2,
        maxzoom: 7,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Semibold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 2, 11, 5, 15],
          "text-rotate": ["coalesce", ["get", "angle"], 0],
          "text-letter-spacing": 0.15,
          "text-transform": "uppercase",
        },
        paint: {
          "text-color": "#1f1306",
          "text-halo-color": "rgba(255, 248, 230, 0.95)",
          "text-halo-width": 1.5,
        },
      },
    ],
  };
}

/**
 * Resolve a tile-style setting value to a MapLibre style.
 * - "golarion" (default) -> bundled Golarion style + module-served pmtiles
 * - "earth" -> MapLibre demotiles
 * - any other value: treated as a style.json URL
 */
export function resolveStyle(
  setting: string,
  moduleBaseUrl: string,
): StyleSpecification | string {
  const value = (setting || "").trim();
  if (value === "" || value === "golarion") {
    return golarionStyle(
      `${moduleBaseUrl}/golarion.pmtiles`,
      `${moduleBaseUrl}/terrain/{z}/{x}/{y}.png`,
    );
  }
  if (value === "earth") return EARTH_DEMO_STYLE_URL;
  return value;
}
