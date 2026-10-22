/**
 * ====================================================================
 * ANOR CHECK
 * GLYPHS LIBRARY V8.0 - 12 TYPES OFFICIELS & SYNCHRONISÉS
 * SOURCE DE VÉRITÉ DES GLYPHES & PALETTE VECTORIELLE
 * ====================================================================
 */

const GlyphsLibrary = {

    VERSION: "8.0.0",

    /**
     * ALPHABET OFFICIEL : 12 TYPES DE GLYPHES REQUIS
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
        square:        { type: "square", width: 16, height: 16, areaModel: "rectangle", reconstruction: "square" },
        square_dot:    { type: "square_dot", width: 16, height: 16, areaModel: "rectangle", reconstruction: "square" },
        square_inner:  { type: "square_inner", width: 16, height: 16, areaModel: "rectangle", reconstruction: "square" },
        rect:          { type: "rect", width: 22, height: 10, areaModel: "rectangle", reconstruction: "rectangle" },
        rect_half:     { type: "rect_half", width: 22, height: 10, areaModel: "rectangle", reconstruction: "rectangle" },
        rect_double:   { type: "rect_double", width: 22, height: 10, areaModel: "rectangle", reconstruction: "rectangle" },
        circle:        { type: "circle", width: 16, height: 16, radius: 8, areaModel: "circle", reconstruction: "circle" },
        circle_dot:    { type: "circle_dot", width: 16, height: 16, radius: 8, areaModel: "circle", reconstruction: "circle" },
        diamond:       { type: "diamond", width: 16, height: 16, rotation: 45, areaModel: "diamond", reconstruction: "diamond" },
        diamond_inner: { type: "diamond_inner", width: 16, height: 16, rotation: 45, areaModel: "diamond", reconstruction: "diamond" },
        plus:          { type: "plus", width: 18, height: 18, areaModel: "plus", reconstruction: "plus" },
        bar:           { type: "bar", width: 20, height: 6, areaModel: "rectangle", reconstruction: "rectangle" }
    },

    TRUTHMODE: {
        emptyThreshold: 0.45,
        fullThreshold: 0.55,
        validationMargin: 0.05,
        minimumConfidence: 0.95,
        reconstructionThreshold: 0.70
    },

    MEASUREMENT: {
        passes: 5,
        minimumCoverage: 0.60,
        edgeTolerance: 0.15,
        minimumGlyphPixels: 3,
        reconstructionSize: 32
    },

    resolveGlyph(index) {
        const safeIndex = Number.isFinite(Number(index))
            ? Math.abs(Math.floor(Number(index)))
            : 0;
        return this.types[safeIndex % this.types.length];
    },

    getGlyphDefinition(type) {
        if (!type || !this.definitions[type]) {
            return { type: "square", width: 16, height: 16, areaModel: "rectangle", reconstruction: "square" };
        }
        return { ...this.definitions[type] };
    },

    getTheoreticalArea(type) {
        const glyph = this.getGlyphDefinition(type);
        switch (glyph.areaModel) {
            case "circle":
                return Math.PI * Math.pow(glyph.radius || 8, 2);
            case "diamond":
                return (glyph.width * glyph.height) / 2;
            case "plus": {
                const branch = glyph.width / 3;
                return (glyph.width * branch) + (glyph.height * branch) - (branch * branch);
            }
            case "rectangle":
            default:
                return (glyph.width * glyph.height);
        }
    },

    normalizeFillRatio(value) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
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
        const { emptyThreshold, fullThreshold } = this.TRUTHMODE;

        if (ratio <= emptyThreshold) {
            return Number(Math.min(1, (emptyThreshold - ratio) / emptyThreshold + 0.5).toFixed(3));
        }
        if (ratio >= fullThreshold) {
            return Number(Math.min(1, (ratio - fullThreshold) / (1 - fullThreshold) + 0.5).toFixed(3));
        }
        const distance = Math.min(ratio - emptyThreshold, fullThreshold - ratio);
        return Number(Math.max(0, 0.5 - distance).toFixed(3));
    },

    analyzeGlyph(type, fillRatio, options = {}) {
        const glyph = this.getGlyphDefinition(type);
        const ratio = this.normalizeFillRatio(fillRatio);
        const state = this.classifyFill(ratio);
        const confidence = this.calculateConfidence(ratio);
        let bit = this.stateToBit(state);

        if (options.strict === true && state === "UNCERTAIN") {
            bit = null;
        }

        return {
            type: glyph.type,
            geometry: glyph.reconstruction,
            fillRatio: ratio,
            state,
            bit,
            confidence,
            reliable: (bit !== null && confidence >= this.TRUTHMODE.minimumConfidence),
            needsReconstruction: (confidence < this.TRUTHMODE.minimumConfidence),
            definition: glyph
        };
    },

    aggregateMeasurements(type, measurements = []) {
        if (!Array.isArray(measurements) || measurements.length === 0) {
            return {
                type, state: "UNCERTAIN", bit: null, fillRatio: 0, confidence: 0,
                votes: { empty: 0, full: 0, uncertain: 0 }
            };
        }

        const analyses = measurements.map(m => this.analyzeGlyph(type, typeof m === "object" ? m.fillRatio : m));
        let emptyVotes = 0, fullVotes = 0, uncertainVotes = 0;

        for (const a of analyses) {
            if (a.state === "EMPTY") emptyVotes++;
            else if (a.state === "FULL") fullVotes++;
            else uncertainVotes++;
        }

        const average = analyses.reduce((sum, item) => sum + item.fillRatio, 0) / analyses.length;
        let state = "UNCERTAIN";
        if (fullVotes > emptyVotes && fullVotes > uncertainVotes) state = "FULL";
        else if (emptyVotes > fullVotes && emptyVotes > uncertainVotes) state = "EMPTY";

        const bit = this.stateToBit(state);
        const baseConfidence = this.calculateConfidence(average);
        const consensus = Math.max(emptyVotes, fullVotes) / analyses.length;
        const confidence = Number(Math.min(1, (baseConfidence * 0.60) + (consensus * 0.40)).toFixed(3));

        return {
            type, state, bit,
            fillRatio: Number(average.toFixed(4)),
            confidence,
            reliable: (bit !== null && confidence >= this.TRUTHMODE.minimumConfidence),
            votes: { empty: emptyVotes, full: fullVotes, uncertain: uncertainVotes },
            measurements: analyses
        };
    },

    isValidType(type) {
        return this.types.includes(type);
    },

    getProtocolInfo() {
        return {
            version: this.VERSION,
            types: [...this.types],
            truthMode: { ...this.TRUTHMODE },
            measurement: { ...this.MEASUREMENT },
            definitions: Object.keys(this.definitions).reduce((result, type) => {
                result[type] = this.getGlyphDefinition(type);
                return result;
            }, {})
        };
    }
};

if (typeof module !== "undefined" && module.exports) {
    module.exports = GlyphsLibrary;
}
if (typeof window !== "undefined") {
    window.GlyphsLibrary = GlyphsLibrary;
}