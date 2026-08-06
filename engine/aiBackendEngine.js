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
     */
    toHybridSerial(num) {
        const n = parseInt(num, 10);
        if (isNaN(n) || n <= 0) return '0';

        if (n < 10) return n.toString();

        const anorMapping = [
            { val: 100000, symbol: 'CM' },
            { val: 50000,  symbol: 'LM' },
            { val: 10000,  symbol: 'DM' },
            { val: 1000,   symbol: 'M'  },
            { val: 500,    symbol: 'D'  },
            { val: 100,    symbol: 'C'  },
            { val: 50,     symbol: 'L'  },
            { val: 10,     symbol: 'X'  }
        ];

        let result = '';
        let remainder = n;

        for (const { val, symbol } of anorMapping) {
            while (remainder >= val) {
                result += (result.length > 0 && symbol.length > 1 ? '-' : '') + symbol;
                remainder -= val;
            }
        }

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

        const ringConfigs = [
            { radius: 190, count: 12, isInner: true },  // Interne : 7 glyphes affichés
            { radius: 248, count: 24, isInner: false }, // Médian : complet
            { radius: 305, count: 32, isInner: false }   // Externe : complet
        ];

        let cursor = 0;
        const matrix = [];
        let globalIndexOffset = 0;

        ringConfigs.forEach((ringConfig, ringIndex) => {
            const { radius: baseRadius, count: numPerRing, isInner } = ringConfig;

            for (let i = 0; i < numPerRing; i++) {
                const angle = (i / numPerRing) * Math.PI * 2;
                const angleDeg = (angle * 180) / Math.PI;

                if (isInner) {
                    if (angleDeg >= 20 && angleDeg <= 160) {
                        continue; 
                    }
                }

                const a = parseInt(hash.substr(cursor % 120, 2), 16);
                const b = parseInt(hash.substr((cursor + 2) % 120, 2), 16);
                const c = parseInt(hash.substr((cursor + 4) % 120, 2), 16);
                const d = parseInt(hash.substr((cursor + 6) % 120, 2), 16);

                cursor += 8;

                const jitterAngle = ((a / 255) - 0.5) * 0.08;
                const finalAngle = angle + jitterAngle;
                const radius = baseRadius + ((b / 255) - 0.5) * 18;
                const glyph = GlyphsLibrary.resolveGlyph(c);

                let width, height;
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

                const rotation = (d / 255) * Math.PI * 2;
                const filled = (a % 3) !== 0;
                const strokeWidth = 1 + (b % 3);
                const opacity = 0.88 + ((c % 12) / 100);
                const weight = (a + b + c + d) % 256;

                matrix.push({
                    id: ringIndex + "_" + i,
                    ring: ringIndex,
                    radius,
                    angle: finalAngle,
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
            globalIndexOffset += numPerRing;
        });

        const aiSignature = crypto
            .createHash("sha256")
            .update(JSON.stringify(matrix))
            .digest("hex");

        return {
            matrix,
            aiSignature
        };
    },

    rotateMatrix(matrix, angleOffset) {
        if (!Array.isArray(matrix)) return [];
        const twoPi = Math.PI * 2;
        return matrix.map(item => ({
            ...item,
            angle: (item.angle + angleOffset + twoPi) % twoPi
        }));
    },

    normalizeGeometry(matrix) {
        if (!Array.isArray(matrix) || matrix.length === 0) return [];
        const radii = matrix.map(g => g.radius);
        const minRadius = Math.min(...radii);
        const maxRadius = Math.max(...radii);
        const radiusRange = Math.max(maxRadius - minRadius, 1);

        return matrix.map(item => ({
            ...item,
            radius: (item.radius - minRadius) / radiusRange,
            angle: item.angle % (Math.PI * 2),
            width: item.width / 20,
            height: item.height / 20,
            rotation: item.rotation % (Math.PI * 2)
        }));
    },

    evaluateCoreRing(scannedMatrix, referenceMatrix) {
        if (!Array.isArray(scannedMatrix) || !Array.isArray(referenceMatrix)) {
            return { coreMatchScore: 0, validCore: false };
        }

        const scanCore = scannedMatrix.filter(g => g.ring === 0);
        const refCore = referenceMatrix.filter(g => g.ring === 0);

        if (refCore.length === 0 || scanCore.length === 0) {
            return { coreMatchScore: 1.0, validCore: true };
        }

        let matches = 0;
        for (const scanG of scanCore) {
            const found = refCore.some(refG => refG.glyph === scanG.glyph && Math.abs(refG.angle - scanG.angle) < 0.15);
            if (found) matches++;
        }

        const coreMatchScore = matches / Math.max(scanCore.length, 1);
        return {
            coreMatchScore,
            validCore: coreMatchScore >= 0.50
        };
    },

    /**
     * ==========================================================================
     * NOUVELLE FONCTION : ÉVALUATION RAPIDE DE L'ANNEAU INTERNE (ÉTAPE 1)
     * ==========================================================================
     * Permet de matcher rapidement les glyphes de l'anneau interne (ring 0) 
     * pour filtrer les candidats potentiels en base sans exécuter l'algorithme lourd.
     */
    evaluateStep1Ring0(scannedRing0, candidateReferenceMatrix) {
        if (!Array.isArray(scannedRing0) || !Array.isArray(candidateReferenceMatrix)) {
            return { matchScore: 0, isMatch: false };
        }

        const refRing0 = candidateReferenceMatrix.filter(g => g.ring === 0);
        if (refRing0.length === 0 || scannedRing0.length === 0) {
            return { matchScore: 1.0, isMatch: true };
        }

        let matches = 0;
        for (const scanG of scannedRing0) {
            const found = refRing0.some(refG => 
                refG.glyph === scanG.glyph && 
                Math.abs(refG.angle - scanG.angle) < 0.20
            );
            if (found) matches++;
        }

        const matchScore = matches / Math.max(scannedRing0.length, 1);
        return {
            matchScore,
            isMatch: matchScore >= 0.60
        };
    },

    findBestMatch(scanGlyph, referenceMatrix, usedIndexes) {
        let bestIndex = -1;
        let bestScore = -Infinity;

        for (let i = 0; i < referenceMatrix.length; i++) {
            if (usedIndexes.has(i)) continue;

            const ref = referenceMatrix[i];
            let score = 0;

            if (scanGlyph.glyph === ref.glyph) score += 40;

            score -= Math.abs(scanGlyph.radius - ref.radius) * 400;
            score -= Math.abs(scanGlyph.angle - ref.angle) * 120;
            score -= Math.abs(scanGlyph.rotation - ref.rotation) * 80;
            score -= Math.abs(scanGlyph.width - ref.width) * 25;
            score -= Math.abs(scanGlyph.height - ref.height) * 25;

            if (scanGlyph.filled === ref.filled) score += 15;

            if (score > bestScore) {
                bestScore = score;
                bestIndex = i;
            }
        }
        return bestIndex;
    },

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
            const bestIndex = this.findBestMatch(scan, referenceMatrix, usedIndexes);
            if (bestIndex === -1) continue;

            usedIndexes.add(bestIndex);
            const ref = referenceMatrix[bestIndex];
            maximumScore += 100;

            if (scan.glyph === ref.glyph) {
                obtainedScore += 30;
                glyphMatches++;
            }

            const dr = Math.abs(scan.radius - ref.radius);
            const radiusTolerance = ref.radius > 0.70 ? 0.060 : 0.090;

            if (dr <= radiusTolerance) {
                obtainedScore += 20;
                radiusMatches++;
            }
            else if (dr <= radiusTolerance * 2) {
                obtainedScore += 12;
            }

            const da = Math.abs(scan.angle - ref.angle);
            if (da <= 0.03) {
                obtainedScore += 15;
                angleMatches++;
            }
            else if (da <= 0.08) {
                obtainedScore += 8;
            }

            const drot = Math.abs(scan.rotation - ref.rotation);
            if (drot <= 0.10) {
                obtainedScore += 15;
                rotationMatches++;
            }
            else if (drot <= 0.25) {
                obtainedScore += 8;
            }

            if (scan.filled === ref.filled) {
                obtainedScore += 10;
                fillMatches++;
            }

            const dw = Math.abs(scan.width - ref.width);
            const dh = Math.abs(scan.height - ref.height);

            if (dw <= 0.06 && dh <= 0.06) {
                obtainedScore += 10;
                sizeMatches++;
            }
            else if (dw <= 0.12 && dh <= 0.12) {
                obtainedScore += 5;
            }
        }

        const unmatched = referenceMatrix.length - usedIndexes.size;
        obtainedScore -= unmatched * 5;

        if (obtainedScore < 0) obtainedScore = 0;

        const total = Math.min(scannedMatrix.length, referenceMatrix.length);

        return {
            confidence: maximumScore === 0 ? 0 : obtainedScore / maximumScore,
            coverage: usedIndexes.size / referenceMatrix.length,
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

    computeAdaptiveThreshold(metrics) {
        let threshold = 0.88;

        if (metrics.coverage > 0.98) threshold -= 0.03;
        else if (metrics.coverage < 0.92) threshold += 0.04;

        const glyphRatio = metrics.details.glyphMatches / Math.max(metrics.details.total, 1);
        if (glyphRatio > 0.95) threshold -= 0.02;
        else if (glyphRatio < 0.80) threshold += 0.03;

        const rotationRatio = metrics.details.rotationMatches / Math.max(metrics.details.total, 1);
        if (rotationRatio < 0.70) threshold += 0.02;

        threshold = Math.max(0.68, Math.min(threshold, 0.95));

        return Number(threshold.toFixed(3));
    },

    /**
     * ÉVALUATION SÉQUENTIELLE LOURDE (ÉTAPE 2 - ENTONNOIR IA-6)
     * Conserve l'intégralité du système de rotations et d'analyse fine multi-anneaux (24 & 32 glyphes).
     */
    evaluateScanConfidence(scannedMatrix, referenceMatrix) {
        if (!Array.isArray(scannedMatrix) || !Array.isArray(referenceMatrix)) {
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

        const total = Math.min(scannedMatrix.length, referenceMatrix.length);
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

        const rotations = [-15, -10, -5, 0, 5, 10, 15];

        let bestConfidence = 0;
        let bestCoverage = 0;
        let bestDetails = null;

        let coreValidatedRotations = [];

        for (const deg of rotations) {
            const rotatedReference = this.normalizeGeometry(
                this.rotateMatrix(referenceMatrix, deg * Math.PI / 180)
            );
            const normalizedScan = this.normalizeGeometry(scannedMatrix);

            const coreCheck = this.evaluateCoreRing(normalizedScan, rotatedReference);
            
            if (coreCheck.validCore) {
                coreValidatedRotations.push({ deg, coreMatchScore: coreCheck.coreMatchScore, rotatedReference, normalizedScan });
            }
        }

        const targetRotations = coreValidatedRotations.length > 0 
            ? coreValidatedRotations 
            : rotations.map(deg => ({
                deg,
                coreMatchScore: 0.5,
                rotatedReference: this.normalizeGeometry(this.rotateMatrix(referenceMatrix, deg * Math.PI / 180)),
                normalizedScan: this.normalizeGeometry(scannedMatrix)
              }));

        for (const candidate of targetRotations) {
            const { rotatedReference, normalizedScan, coreMatchScore } = candidate;

            const result = this.evaluateWeighted(normalizedScan, rotatedReference);
            const adjustedConfidence = result.confidence * (0.8 + (coreMatchScore * 0.2));

            if (adjustedConfidence > bestConfidence) {
                bestConfidence = adjustedConfidence;
                bestCoverage = result.coverage;
                bestDetails = result.details;
            }
        }

        const adaptiveThreshold = this.computeAdaptiveThreshold({
            confidence: bestConfidence,
            coverage: bestCoverage,
            details: bestDetails
        });

        const qualityIndex = Math.round((bestConfidence * 0.6 + bestCoverage * 0.4) * 100);

        let confidenceClass = "LOW";
        if (bestConfidence >= 0.96) confidenceClass = "EXCELLENT";
        else if (bestConfidence >= 0.92) confidenceClass = "HIGH";
        else if (bestConfidence >= 0.88) confidenceClass = "MEDIUM";

        const anomalyDetected = bestCoverage < 0.80 || bestDetails.glyphMatches < bestDetails.total * 0.65;

        return {
            isValid: bestConfidence >= adaptiveThreshold,
            confidence: Number(bestConfidence.toFixed(4)),
            adaptiveThreshold,
            qualityIndex,
            confidenceClass,
            anomalyDetected,
            coverage: Number(bestCoverage.toFixed(3)),
            rotationCorrection: true,
            details: bestDetails
        };
    }

};

module.exports = AiBackendEngine;