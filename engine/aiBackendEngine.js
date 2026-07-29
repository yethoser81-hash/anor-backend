const crypto = require("crypto");
const GlyphsLibrary = require("../library/glyphsLibrary");

/**
 * IA Géométrique Souveraine ANOR
 * Génère et vérifie la matrice géométrique du sceau ANOR.
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
            { val: 500,    symbol: 'D'  }, // Cinq Cents
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
                // angle légèrement irrégulier
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
                    1 + (b % 3);

                //----------------------------------------------
                // opacité
                //----------------------------------------------

                const opacity =
                    0.88 + ((c % 12) / 100);

                //----------------------------------------------
                // poids IA
                //----------------------------------------------

                const weight =
                    (a + b + c + d) % 256;

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
    // Rotation virtuelle d'une matrice géométrique (Livraison IA-2)
    //--------------------------------------------------------

    rotateMatrix(matrix, angleOffset) {

        if (!Array.isArray(matrix)) {
            return [];
        }

        const twoPi = Math.PI * 2;

        return matrix.map(item => ({

            ...item,

            angle:
                (
                    item.angle +
                    angleOffset +
                    twoPi
                ) % twoPi

        }));

    },

    //--------------------------------------------------------
    // Correction légère de perspective (Livraison IA-3)
    //--------------------------------------------------------

    normalizeGeometry(matrix) {

        if (!Array.isArray(matrix) || matrix.length === 0) {
            return [];
        }

        const radii = matrix.map(g => g.radius);

        const minRadius = Math.min(...radii);
        const maxRadius = Math.max(...radii);

        const radiusRange = Math.max(maxRadius - minRadius, 1);

        return matrix.map(item => ({

            ...item,

            radius:
                (
                    item.radius - minRadius
                ) / radiusRange,

            angle:
                item.angle % (Math.PI * 2),

            width:
                item.width / 20,

            height:
                item.height / 20,

            rotation:
                item.rotation % (Math.PI * 2)

        }));

    },

    //--------------------------------------------------------
    // Recherche du meilleur correspondant géométrique (Livraison IA-5)
    //--------------------------------------------------------

    findBestMatch(scanGlyph, referenceMatrix, usedIndexes) {

        let bestIndex = -1;

        let bestScore = -Infinity;

        for (let i = 0; i < referenceMatrix.length; i++) {

            if (usedIndexes.has(i))
                continue;

            const ref = referenceMatrix[i];

            let score = 0;

            if (scanGlyph.glyph === ref.glyph)
                score += 40;

            score -=
                Math.abs(scanGlyph.radius - ref.radius) * 400;

            score -=
                Math.abs(scanGlyph.angle - ref.angle) * 120;

            score -=
                Math.abs(scanGlyph.rotation - ref.rotation) * 80;

            score -=
                Math.abs(scanGlyph.width - ref.width) * 25;

            score -=
                Math.abs(scanGlyph.height - ref.height) * 25;

            if (scanGlyph.filled === ref.filled)
                score += 15;

            if (score > bestScore) {

                bestScore = score;

                bestIndex = i;

            }

        }

        return bestIndex;

    },

    //--------------------------------------------------------
    // Comparaison pondérée normalisée (Livraison IA-5)
    //--------------------------------------------------------

    evaluateWeighted(scannedMatrix, referenceMatrix) {

        let obtainedScore = 0;

        let maximumScore = 0;

        let glyphMatches = 0;

        let radiusMatches = 0;

        let angleMatches = 0;

        let rotationMatches = 0;

        let fillMatches = 0;

        let sizeMatches = 0;

        const usedIndexes = new Set();

        for (const scan of scannedMatrix) {

            const bestIndex =
                this.findBestMatch(
                    scan,
                    referenceMatrix,
                    usedIndexes
                );

            if (bestIndex === -1)
                continue;

            usedIndexes.add(bestIndex);

            const ref = referenceMatrix[bestIndex];

            maximumScore += 100;

            //--------------------------------

            if (scan.glyph === ref.glyph) {

                obtainedScore += 30;

                glyphMatches++;

            }

            //--------------------------------

            const dr =
                Math.abs(
                    scan.radius -
                    ref.radius
                );

            /*
            Tolérance progressive
            */

            const radiusTolerance =
                ref.radius > 0.70
                ? 0.030
                : 0.045;

            if (
                dr <=
                radiusTolerance
            ) {

                obtainedScore += 20;

                radiusMatches++;

            }
            else if (
                dr <=
                radiusTolerance * 2
            ) {

                obtainedScore += 10;

            }

            //--------------------------------

            const da =
                Math.abs(
                    scan.angle -
                    ref.angle
                );

            if (da <= 0.03) {

                obtainedScore += 15;

                angleMatches++;

            }
            else if (da <= 0.08) {

                obtainedScore += 8;

            }

            //--------------------------------

            const drot =
                Math.abs(
                    scan.rotation -
                    ref.rotation
                );

            if (drot <= 0.10) {

                obtainedScore += 15;

                rotationMatches++;

            }
            else if (drot <= 0.25) {

                obtainedScore += 8;

            }

            //--------------------------------

            if (
                scan.filled ===
                ref.filled
            ) {

                obtainedScore += 10;

                fillMatches++;

            }

            //--------------------------------

            const dw =
                Math.abs(
                    scan.width -
                    ref.width
                );

            const dh =
                Math.abs(
                    scan.height -
                    ref.height
                );

            if (
                dw <= 0.06 &&
                dh <= 0.06
            ) {

                obtainedScore += 10;

                sizeMatches++;

            }
            else if (
                dw <= 0.12 &&
                dh <= 0.12
            ) {

                obtainedScore += 5;

            }

        }

        // Pénalité sur les glyphes manquants
        const unmatched =
            referenceMatrix.length -
            usedIndexes.size;

        obtainedScore -= unmatched * 5;

        if (obtainedScore < 0)
            obtainedScore = 0;

        const total = Math.min(
            scannedMatrix.length,
            referenceMatrix.length
        );

        return {

            confidence:
                maximumScore === 0
                    ? 0
                    : obtainedScore /
                      maximumScore,

            coverage:
                usedIndexes.size /
                referenceMatrix.length,

            details: {

                glyphMatches,

                radiusMatches,

                angleMatches,

                rotationMatches,

                fillMatches,

                sizeMatches,

                total

            }

        };

    },

    //--------------------------------------------------------
    // Calcul dynamique du seuil de validation (Livraison IA-6)
    //--------------------------------------------------------

    computeAdaptiveThreshold(metrics) {

        let threshold = 0.88;

        //---------------------------------------
        // couverture
        //---------------------------------------

        if (metrics.coverage > 0.98)
            threshold -= 0.03;

        else if (metrics.coverage < 0.92)
            threshold += 0.04;

        //---------------------------------------
        // reconnaissance des glyphes
        //---------------------------------------

        const glyphRatio =
            metrics.details.glyphMatches /
            Math.max(metrics.details.total, 1);

        if (glyphRatio > 0.95)
            threshold -= 0.02;

        else if (glyphRatio < 0.80)
            threshold += 0.03;

        //---------------------------------------
        // rotation
        //---------------------------------------

        const rotationRatio =
            metrics.details.rotationMatches /
            Math.max(metrics.details.total, 1);

        if (rotationRatio < 0.70)
            threshold += 0.02;

        //---------------------------------------
        // borne finale
        //---------------------------------------

        threshold =
            Math.max(
                0.82,
                Math.min(
                    threshold,
                    0.95
                )
            );

        return Number(
            threshold.toFixed(3)
        );

    },

    //--------------------------------------------------------
    // Vérification IA multi-rotation & adaptative (Livraison IA-6)
    //--------------------------------------------------------

    evaluateScanConfidence(scannedMatrix, referenceMatrix) {

        if (
            !Array.isArray(scannedMatrix) ||
            !Array.isArray(referenceMatrix)
        ) {

            return {
                isValid: false,
                confidence: 0,
                adaptiveThreshold: 0.88,
                qualityIndex: 0,
                confidenceClass: "LOW",
                anomalyDetected: true,
                coverage: 0,
                rotationCorrection: true,
                details: {}
            };

        }

        const total = Math.min(
            scannedMatrix.length,
            referenceMatrix.length
        );

        if (total === 0) {

            return {
                isValid: false,
                confidence: 0,
                adaptiveThreshold: 0.88,
                qualityIndex: 0,
                confidenceClass: "LOW",
                anomalyDetected: true,
                coverage: 0,
                rotationCorrection: true,
                details: {}
            };

        }

        const rotations = [
            -15,
            -10,
            -5,
            0,
            5,
            10,
            15
        ];

        let bestConfidence = 0;
        let bestCoverage = 0;
        let bestDetails = null;

        for (const deg of rotations) {

            const rotatedReference =
                this.normalizeGeometry(
                    this.rotateMatrix(
                        referenceMatrix,
                        deg * Math.PI / 180
                    )
                );

            const normalizedScan =
                this.normalizeGeometry(
                    scannedMatrix
                );

            const result =
                this.evaluateWeighted(
                    normalizedScan,
                    rotatedReference
                );

            if (
                result.confidence >
                bestConfidence
            ) {

                bestConfidence =
                    result.confidence;

                bestCoverage =
                    result.coverage;

                bestDetails =
                    result.details;

            }

        }

        //--------------------------------------------------------
        // Calculs décisionnels IA-6
        //--------------------------------------------------------

        const adaptiveThreshold =
            this.computeAdaptiveThreshold({
                confidence: bestConfidence,
                coverage: bestCoverage,
                details: bestDetails
            });

        const qualityIndex =
            Math.round(
                (
                    bestConfidence * 0.6 +
                    bestCoverage * 0.4
                ) * 100
            );

        let confidenceClass = "LOW";

        if (bestConfidence >= 0.96)
            confidenceClass = "EXCELLENT";

        else if (bestConfidence >= 0.92)
            confidenceClass = "HIGH";

        else if (bestConfidence >= 0.88)
            confidenceClass = "MEDIUM";

        const anomalyDetected =
            bestCoverage < 0.80 ||
            bestDetails.glyphMatches <
            bestDetails.total * 0.65;

        //--------------------------------------------------------
        // Retour final avec métriques décisionnelles
        //--------------------------------------------------------

        return {

            isValid:
                bestConfidence >= adaptiveThreshold,

            confidence: Number(
                bestConfidence.toFixed(4)
            ),

            adaptiveThreshold,

            qualityIndex,

            confidenceClass,

            anomalyDetected,

            coverage: Number(
                bestCoverage.toFixed(3)
            ),

            rotationCorrection: true,

            details: bestDetails

        };

    }

};

module.exports = AiBackendEngine;