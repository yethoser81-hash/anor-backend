/**
 * ====================================================================
 * ANOR CHECK
 * GLYPHS LIBRARY V8.0 - PALETTE STRICTE & SANS DEFORMATION
 * SOURCE DE VÉRITÉ DES GLYPHES
 * ====================================================================
 */

const GlyphsLibrary = {

    VERSION: "8.0.0",

    /**
     * ALPHABET STRICT (Exclusion des étoiles et triangles)
     */
    types: [
        "square",          // Carré simple
        "square_dot",      // Carré avec point central
        "square_inner",    // Carré concentrique
        "rect",            // Rectangle simple
        "rect_half",       // Rectangle semi-plein
        "rect_double",     // Double rectangle
        "circle",          // Cercle simple
        "circle_dot",      // Cercle avec point central
        "diamond",         // Losange
        "diamond_inner",   // Losange imbriqué
        "plus",            // Croix
        "bar"              // Bâtonnet
    ],

    definitions: {
        square:        { type: "square", width: 16, height: 16, areaModel: "rectangle" },
        square_dot:    { type: "square_dot", width: 16, height: 16, areaModel: "rectangle" },
        square_inner:  { type: "square_inner", width: 16, height: 16, areaModel: "rectangle" },
        rect:          { type: "rect", width: 20, height: 10, areaModel: "rectangle" },
        rect_half:     { type: "rect_half", width: 20, height: 10, areaModel: "rectangle" },
        rect_double:   { type: "rect_double", width: 20, height: 10, areaModel: "rectangle" },
        circle:        { type: "circle", width: 16, height: 16, radius: 8, areaModel: "circle" },
        circle_dot:    { type: "circle_dot", width: 16, height: 16, radius: 8, areaModel: "circle" },
        diamond:       { type: "diamond", width: 16, height: 16, rotation: 45, areaModel: "diamond" },
        diamond_inner: { type: "diamond_inner", width: 16, height: 16, rotation: 45, areaModel: "diamond" },
        plus:          { type: "plus", width: 18, height: 18, areaModel: "plus" },
        bar:           { type: "bar", width: 20, height: 6, areaModel: "rectangle" }
    },

    resolveGlyph(index) {
        const safeIndex = Number.isFinite(Number(index))
            ? Math.abs(Math.floor(Number(index)))
            : 0;
        return this.types[safeIndex % this.types.length];
    },

    getGlyphDefinition(type) {
        if (!type || !this.definitions[type]) {
            return { type: "square", width: 16, height: 16, areaModel: "rectangle" };
        }
        return { ...this.definitions[type] };
    }
};

if (typeof module !== "undefined" && module.exports) {
    module.exports = GlyphsLibrary;
}
if (typeof window !== "undefined") {
    window.GlyphsLibrary = GlyphsLibrary;
}