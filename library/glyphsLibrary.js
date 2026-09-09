/**
 * ====================================================================
 * ANOR CHECK
 * GLYPHS LIBRARY V6.2 - TRUTHMODE MONOCHROME & RAPIDE
 * ====================================================================
 */

const GlyphsLibrary = {
    types: ["square", "rect", "circle", "diamond", "plus"],
    VERSION: "6.2.0",

    TRUTHMODE: {
        emptyThreshold: 0.40,
        fullThreshold: 0.60,
        minimumConfidence: 0.85
    },

    definitions: {
        square: { type: "square", width: 18, height: 18, areaModel: "rectangle", reconstruction: "square" },
        rect: { type: "rect", width: 36, height: 9, areaModel: "rectangle", reconstruction: "rectangle" },
        circle: { type: "circle", width: 18, height: 18, radius: 9, areaModel: "circle", reconstruction: "circle" },
        diamond: { type: "diamond", width: 16, height: 16, rotation: 45, areaModel: "diamond", reconstruction: "diamond" },
        plus: { type: "plus", width: 20, height: 20, areaModel: "plus", reconstruction: "plus" }
    },

    resolveGlyph(index) {
        const safeIndex = Number.isFinite(Number(index)) ? Math.abs(Math.floor(Number(index))) : 0;
        return this.types[safeIndex % this.types.length];
    },

    getGlyphDefinition(type) {
        if (!type || !this.definitions[type]) {
            return { type: "unknown", width: 18, height: 18, areaModel: "rectangle", reconstruction: "rectangle" };
        }
        return { ...this.definitions[type] };
    },

    normalizeFillRatio(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return 0;
        return Math.max(0, Math.min(1, number));
    },

    classifyFill(fillRatio) {
        const ratio = this.normalizeFillRatio(fillRatio);
        if (ratio <= this.TRUTHMODE.emptyThreshold) return "EMPTY";
        if (ratio >= this.TRUTHMODE.fullThreshold) return "FULL";
        return "UNCERTAIN";
    },

    stateToBit(state) {
        if (state === "FULL") return 1;
        if (state === "EMPTY") return 0;
        return null;
    },

    calculateConfidence(fillRatio) {
        const ratio = this.normalizeFillRatio(fillRatio);
        const distance = Math.abs(ratio - 0.5);
        return Number(Math.min(1, distance * 2 + 0.5).toFixed(3));
    },

    analyzeGlyph(type, fillRatio) {
        const glyph = this.getGlyphDefinition(type);
        const ratio = this.normalizeFillRatio(fillRatio);
        const state = this.classifyFill(ratio);
        const confidence = this.calculateConfidence(ratio);
        const bit = this.stateToBit(state);

        return {
            type: glyph.type,
            geometry: glyph.reconstruction,
            fillRatio: ratio,
            state,
            bit,
            confidence,
            reliable: bit !== null && confidence >= this.TRUTHMODE.minimumConfidence
        };
    },

    decodeGlyph(type, fillRatio, options = {}) {
        return this.analyzeGlyph(type, fillRatio);
    },

    isValidType(type) {
        return this.types.includes(type);
    }
};

if (typeof module !== "undefined" && module.exports) {
    module.exports = GlyphsLibrary;
}
if (typeof window !== "undefined") {
    window.GlyphsLibrary = GlyphsLibrary;
}