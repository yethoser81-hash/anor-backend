const crypto = require("crypto");
const GlyphsLibrary = require("../library/glyphsLibrary");

/**
 * IA Géométrique Souveraine ANOR
 * Génère une matrice complète directement exploitable
 * par sealRenderer.js sans aucun recalcul.
 */

const AiBackendEngine = {

    /**
     * Sérialisation Souveraine ANOR
     * Adaptée aux grands volumes industriels.
     * 
     * RÈGLES ANOR :
     * - Unités (1 à 9) : Chiffres arabes
     * - 10 : X  |  50 : L  |  100 : C  |  500 : D
     * - 1 000 : M  |  10 000 : DM (Dix Mille)  |  100 000 : CM (Cent Mille)
     * 
     * @param {number|string} num - Numéro de série dans le lot (ex: 1, 12, 10005, 100012)
     * @returns {string} Sérialisation personnalisée (ex: "1", "X-2", "DM-5", "CM-X-2")
     */
    toHybridSerial(num) {
        const n = parseInt(num, 10);
        if (isNaN(n) || n <= 0) return '0';

        // Unités simples (1 à 9)
        if (n < 10) return n.toString();

        const anorMapping = [
            { val: 100000, symbol: 'CM' }, // Cent Mille
            { val: 50000,  symbol: 'LM' }, // Cinquante Mille
            { val: 10000,  symbol: 'DM' }, // Dix Mille
            { val: 1000,   symbol: 'M'  }, // Mille
            { val: 500,    symbol: 'D'  }, // Cing Cents
            { val: 100,    symbol: 'C'  }, // Cent
            { val: 50,     symbol: 'L'  }, // Cinquante
            { val: 10,     symbol: 'X'  }  // Dix
        ];

        let result = '';
        let remainder = n;

        for (const { val, symbol } of anorMapping) {
            while (remainder >= val) {
                result += (result.length > 0 && symbol.length > 1 ? '-' : '') + symbol;
                remainder -= val;
            }
        }

        // Ajout du reste en chiffre arabe (1 à 9)
        if (remainder > 0) {
            result += `-${remainder}`;
        }

        return result;
    },

    generateSmartMatrix(certificateCode) {

        const SECRET = "ANOR_SOVEREIGN_AI_SALT_2026";

        const hash = crypto
            .createHmac("sha512", SECRET)
            .update(String(certificateCode))
            .digest("hex");

        // ----------------------------------------------------
        // Configuration générale
        // ----------------------------------------------------

        const rings = [
            {
                radius: 305,
                count: 38
            },
            {
                radius: 248,
                count: 32
            },
            {
                radius: 190,
                count: 26
            }
        ];

        let cursor = 0;
        const matrix = [];

        //-----------------------------------------------------
        // Construction de la bibliothèque géométrique
        //-----------------------------------------------------

        rings.forEach((ring, ringIndex) => {

            const step = (Math.PI * 2) / ring.count;

            for (let i = 0; i < ring.count; i++) {

                //----------------------------------------------
                // lecture pseudo-aléatoire
                //----------------------------------------------

                const a = parseInt(hash.substr(cursor % 120, 2), 16);
                const b = parseInt(hash.substr((cursor + 2) % 120, 2), 16);
                const c = parseInt(hash.substr((cursor + 4) % 120, 2), 16);
                const d = parseInt(hash.substr((cursor + 6) % 120, 2), 16);

                cursor += 8;

                //----------------------------------------------
                // angle légèrement irregular
                //----------------------------------------------

                const jitterAngle =
                    ((a / 255) - 0.5) * 0.08;

                const angle =
                    i * step + jitterAngle;

                //----------------------------------------------
                // rayon légèrement variable
                //----------------------------------------------

                const radius =
                    ring.radius +
                    ((b / 255) - 0.5) * 18;

                //----------------------------------------------
                // type
                //----------------------------------------------

                const glyph =
                    GlyphsLibrary.resolveGlyph(c);

                //----------------------------------------------
                // taille
                //----------------------------------------------

                let width;
                let height;

                switch (glyph) {

                    case "circle":

                        width = 10 + (d % 5);
                        height = width;
                        break;

                    case "square":

                        width = 11 + (d % 5);
                        height = width;
                        break;

                    case "diamond":

                        width = 12 + (d % 4);
                        height = width;
                        break;

                    case "plus":

                        width = 11 + (d % 3);
                        height = 11 + (d % 3);
                        break;

                    case "rect":

                        width = 5 + (d % 3);

                        height = 20 + (a % 18);

                        break;

                    default:

                        width = 10;
                        height = 10;

                }

                //----------------------------------------------
                // orientation indépendante
                //----------------------------------------------

                const rotation =

                    (d / 255) * Math.PI * 2;

                //----------------------------------------------
                // contour ou plein
                //----------------------------------------------

                const filled = (a % 3) !== 0;

                //----------------------------------------------
                // épaisseur
                //----------------------------------------------

                const strokeWidth =

                    1 +
                    (b % 3);

                //----------------------------------------------
                // opacité
                //----------------------------------------------

                const opacity =

                    0.88 +
                    ((c % 12) / 100);

                //----------------------------------------------
                // poids IA
                //----------------------------------------------

                const weight =

                    (
                        a +
                        b +
                        c +
                        d
                    ) % 256;

                //----------------------------------------------

                matrix.push({

                    id: ringIndex + "_" + i,

                    ring: ringIndex,

                    radius,

                    angle,

                    glyph,

                    rotation,

                    width,

                    height,

                    filled,

                    strokeWidth,

                    opacity,

                    weight

                });

            }

        });

        //----------------------------------------------------
        // Signature IA
        //----------------------------------------------------

        const aiSignature =

            crypto
                .createHash("sha256")
                .update(JSON.stringify(matrix))
                .digest("hex");

        return {

            matrix,

            aiSignature

        };

    },

    //--------------------------------------------------------
    // Vérification
    //--------------------------------------------------------

    evaluateScanConfidence(scannedMatrix, referenceMatrix) {

        if (!scannedMatrix || !referenceMatrix) {

            return {

                isValid: false,

                confidence: 0

            };

        }

        let score = 0;

        const total = Math.min(

            scannedMatrix.length,

            referenceMatrix.length

        );

        for (let i = 0; i < total; i++) {

            const s = scannedMatrix[i];
            const r = referenceMatrix[i];

            if (!s || !r) continue;

            if (s.glyph === r.glyph)
                score += 2;

            if (Math.abs(s.radius - r.radius) < 8)
                score += 2;

            if (Math.abs(s.angle - r.angle) < 0.05)
                score += 2;

            if (s.filled === r.filled)
                score += 1;

            if (Math.abs(s.rotation - r.rotation) < 0.2)
                score += 2;

            if (Math.abs(s.width - r.width) <= 2)
                score += 1;
        }

        const maxScore = total * 10;

        const confidence = maxScore === 0
            ? 0
            : score / maxScore;

        return {

            isValid: confidence >= 0.90,

            confidence: Number(confidence.toFixed(3))

        };

    }

};

module.exports = AiBackendEngine;