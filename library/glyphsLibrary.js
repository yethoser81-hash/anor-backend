/**
 * ====================================================================
 * ANOR CHECK
 * GLYPHS LIBRARY V7.0 - ARCHITECTURE 2 ANNEAUX & ORIENTATION NORD
 * ====================================================================
 */

const GlyphsLibrary = {

    types: ["square", "rect", "circle", "diamond", "plus"],

    VERSION: "7.0.0",

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
        minimumGlyphPixels: 4,
        reconstructionSize: 32
    },

    definitions: {
        square: {
            type: "square",
            width: 22,
            height: 22,
            sides: 4,
            symmetry: "rotational",
            orientation: 0,
            areaModel: "rectangle",
            reconstruction: "square"
        },
        rect: {
            type: "rect",
            width: 42,
            height: 11,
            sides: 4,
            symmetry: "horizontal",
            orientation: 0,
            areaModel: "rectangle",
            reconstruction: "rectangle"
        },
        circle: {
            type: "circle",
            width: 22,
            height: 22,
            radius: 11,
            symmetry: "radial",
            orientation: 0,
            areaModel: "circle",
            reconstruction: "circle"
        },
        diamond: {
            type: "diamond",
            width: 20,
            height: 20,
            rotation: 45,
            symmetry: "rotational",
            orientation: 45,
            areaModel: "diamond",
            reconstruction: "diamond"
        },
        plus: {
            type: "plus",
            width: 24,
            height: 24,
            symbol: "+",
            symmetry: "cross",
            orientation: 0,
            areaModel: "plus",
            reconstruction: "plus"
        }
    },

    resolveGlyph(index) {
        const safeIndex = Number.isFinite(Number(index))
            ? Math.abs(Math.floor(Number(index)))
            : 0;
        return this.types[safeIndex % this.types.length];
    },

    getGlyphDefinition(type) {
        if (!type || !this.definitions[type]) {
            return {
                type: "unknown",
                width: 22,
                height: 22,
                areaModel: "rectangle",
                reconstruction: "rectangle"
            };
        }
        return { ...this.definitions[type] };
    },

    getTheoreticalArea(type) {
        const glyph = this.getGlyphDefinition(type);

        switch (glyph.areaModel) {
            case "circle":
                return Math.PI * Math.pow(glyph.radius, 2);

            case "diamond":
                return (glyph.width * glyph.height) / 2;

            case "plus": {
                const branch = glyph.width / 3;
                const horizontal = glyph.width * branch;
                const vertical = glyph.height * branch;
                const overlap = branch * branch;
                return horizontal + vertical - overlap;
            }

            case "rectangle":
            default:
                return glyph.width * glyph.height;
        }
    },

    normalizeFillRatio(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) {
            return 0;
        }
        return Math.max(0, Math.min(1, number));
    },

    classifyFill(fillRatio) {
        const ratio = this.normalizeFillRatio(fillRatio);
        if (ratio <= this.TRUTHMODE.emptyThreshold) {
            return "EMPTY";
        }
        if (ratio >= this.TRUTHMODE.fullThreshold) {
            return "FULL";
        }
        return "UNCERTAIN";
    },

    stateToBit(state) {
        if (state === "FULL") return 1;
        if (state === "EMPTY") return 0;
        return null;
    },

    calculateConfidence(fillRatio) {
        const ratio = this.normalizeFillRatio(fillRatio);
        const emptyThreshold = this.TRUTHMODE.emptyThreshold;
        const fullThreshold = this.TRUTHMODE.fullThreshold;

        if (ratio <= emptyThreshold) {
            return Number(
                Math.min(
                    1,
                    (emptyThreshold - ratio) / emptyThreshold + 0.5
                ).toFixed(3)
            );
        }

        if (ratio >= fullThreshold) {
            return Number(
                Math.min(
                    1,
                    (ratio - fullThreshold) / (1 - fullThreshold) + 0.5
                ).toFixed(3)
            );
        }

        const distance = Math.min(
            ratio - emptyThreshold,
            fullThreshold - ratio
        );

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
            reliable: bit !== null && confidence >= this.TRUTHMODE.minimumConfidence,
            needsReconstruction: confidence < this.TRUTHMODE.minimumConfidence,
            definition: glyph
        };
    },

    aggregateMeasurements(type, measurements = []) {
        if (!Array.isArray(measurements) || measurements.length === 0) {
            return {
                type,
                state: "UNCERTAIN",
                bit: null,
                fillRatio: 0,
                confidence: 0,
                votes: { empty: 0, full: 0, uncertain: 0 }
            };
        }

        const analyses = measurements.map(measurement => {
            const ratio = typeof measurement === "object" ? measurement.fillRatio : measurement;
            return this.analyzeGlyph(type, ratio);
        });

        let emptyVotes = 0;
        let fullVotes = 0;
        let uncertainVotes = 0;

        for (const analysis of analyses) {
            if (analysis.state === "EMPTY") emptyVotes++;
            else if (analysis.state === "FULL") fullVotes++;
            else uncertainVotes++;
        }

        const average = analyses.reduce((sum, item) => sum + item.fillRatio, 0) / analyses.length;

        let state = "UNCERTAIN";
        if (fullVotes > emptyVotes && fullVotes > uncertainVotes) {
            state = "FULL";
        } else if (emptyVotes > fullVotes && emptyVotes > uncertainVotes) {
            state = "EMPTY";
        }

        const bit = this.stateToBit(state);
        const baseConfidence = this.calculateConfidence(average);
        const winningVotes = Math.max(emptyVotes, fullVotes);
        const consensus = winningVotes / analyses.length;
        const confidence = Number(
            Math.min(1, baseConfidence * 0.60 + consensus * 0.40).toFixed(3)
        );

        return {
            type,
            state,
            bit,
            fillRatio: Number(average.toFixed(4)),
            confidence,
            reliable: bit !== null && confidence >= this.TRUTHMODE.minimumConfidence,
            votes: {
                empty: emptyVotes,
                full: fullVotes,
                uncertain: uncertainVotes
            },
            measurements: analyses
        };
    },

    getProtocolInfo() {
        return {
            version: this.VERSION,
            types: [...this.types],
            truthMode: { ...this.TRUTHMODE },
            measurement: { ...this.MEASUREMENT }
        };
    }
};

if (typeof module !== "undefined" && module.exports) {
    module.exports = GlyphsLibrary;
}
if (typeof window !== "undefined") {
    window.GlyphsLibrary = GlyphsLibrary;
}