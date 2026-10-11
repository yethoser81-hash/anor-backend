/**
 * ====================================================================
 * ANOR CHECK
 * SEAL RENDERER V18.0 - FINALISÉ (LOGO AGRANDI, TEXTE SÉPARÉ, EFFET 2D)
 * ====================================================================
 */

const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const GlyphsLibrary = require('../library/glyphsLibrary');

const VISUAL_VERSION = 2;
const VISIBLE_GLYPH_COUNT = 32;
const CANONICAL_OUTER_RADIUS = 375;

const sealRenderer = {

    deriveVisualBits(seed) {
        const digest = crypto
            .createHash('sha256')
            .update(`ANOR_VISUAL_V${VISUAL_VERSION}:${String(seed)}`)
            .digest();

        let bits = '';
        for (const byte of digest) {
            bits += byte.toString(2).padStart(8, '0');
        }

        return bits.slice(0, VISIBLE_GLYPH_COUNT);
    },

    normalizeVisualBits(bits) {
        if (
            typeof bits === 'string' &&
            new RegExp(`^[01]{${VISIBLE_GLYPH_COUNT}}$`).test(bits)
        ) {
            return bits;
        }
        return null;
    },

    resolveProtocolGlyph(visibleIndex) {
        if (
            GlyphsLibrary &&
            typeof GlyphsLibrary.resolveGlyph === 'function'
        ) {
            return GlyphsLibrary.resolveGlyph(visibleIndex);
        }

        const types = ['square', 'rect', 'circle', 'diamond', 'plus'];
        return types[visibleIndex % types.length];
    },

    getGeometry(width, height) {
        const outerRadius = Math.min(width, height) / 2 - 20;
        const centerX = width / 2;
        const centerY = height / 2;
        
        // Logo agrandi pour absorber le vide central
        const logoSize = 340; 
        const logoRadius = logoSize / 2;

        const outerRingRadius = outerRadius - 35;
        const innerRingRadius = outerRingRadius - 65;

        return {
            centerX,
            centerY,
            outerRadius,
            logoSize,
            logoRadius,
            innerRingRadius,
            outerRingRadius
        };
    },

    getFinderAngles() {
        return [
            -Math.PI / 2, // Nord
            0,            // Est
            Math.PI / 2,  // Sud
            Math.PI       // Ouest
        ];
    },

    getVisiblePositions() {
        const positions = [];

        // 12 glyphes anneau intérieur
        const innerCount = 12;
        for (let i = 0; i < innerCount; i++) {
            const angle = (i / innerCount) * Math.PI * 2 + (Math.PI / 12);
            positions.push({
                ring: 'inner',
                angle,
                index: i
            });
        }

        // 20 glyphes anneau extérieur (5 par quadrant)
        const quadrantAngles = [
            -Math.PI / 2,
            0,
            Math.PI / 2,
            Math.PI,
            Math.PI * 1.5
        ];

        let outerIdx = 0;
        for (let q = 0; q < 4; q++) {
            const startAngle = quadrantAngles[q];
            const endAngle = quadrantAngles[q + 1];
            const countPerQuadrant = 5;

            for (let k = 1; k <= countPerQuadrant; k++) {
                const angle = startAngle + (k / (countPerQuadrant + 1)) * (endAngle - startAngle);
                positions.push({
                    ring: 'outer',
                    angle,
                    index: innerCount + outerIdx
                });
                outerIdx++;
            }
        }

        return positions;
    },

    async renderSealToBuffer(payload = {}, options = {}) {
        const width = Math.max(400, Math.round(options.width || 800));
        const height = Math.max(400, Math.round(options.height || 800));

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        const GEOMETRY_COLOR = options.geometryColor || '#000000';
        const TEXT_PRIMARY_COLOR = options.textColor || '#000000';
        const TEXT_SECONDARY_COLOR = options.subTextColor || '#000000';
        const backgroundColor = options.backgroundColor || '#FFFFFF';

        const geometry = this.getGeometry(width, height);
        const {
            centerX,
            centerY,
            outerRadius,
            logoSize,
            logoRadius,
            innerRingRadius,
            outerRingRadius
        } = geometry;

        const scale = outerRadius / CANONICAL_OUTER_RADIUS;

        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, width, height);

        const rawBatchName =
            payload.lot ||
            payload.batchNumber ||
            payload.batchName ||
            payload.productName ||
            payload.name ||
            options.batchNumber ||
            options.lot;

        if (!rawBatchName) {
            throw new Error('[sealRenderer] Aucun lot fourni.');
        }

        const normalizedBatchName = String(rawBatchName).trim().toUpperCase();
        const batchText = normalizedBatchName.replace(/^LOT\s*/i, '');

        // Nettoyage de la série : suppression de tout ce qui suit le "/"
        const rawMasterLabel = options.masterSerialLabel || '000000';
        const cleanSerialNum = rawMasterLabel.split('/')[0].trim();

        const rawItemNumber =
            payload.itemNumber ??
            options.itemNumber ??
            payload.serialNumber ??
            options.serial;

        const itemText =
            rawItemNumber !== undefined &&
            rawItemNumber !== null &&
            !options.isMasterSeal &&
            !payload.isMasterSeal
                ? String(rawItemNumber).split('/')[0].trim()
                : cleanSerialNum;

        const secureSignature =
            payload.secureSignature ||
            payload.glyph_payload?.secureSignature ||
            null;

        const suppliedVisualBits =
            payload.visualBits ||
            payload.glyph_payload?.visualBits;

        const visualBits =
            this.normalizeVisualBits(suppliedVisualBits) ||
            this.deriveVisualBits(secureSignature || rawBatchName);

        if (!visualBits || visualBits.length !== VISIBLE_GLYPH_COUNT) {
            throw new Error(`[sealRenderer] Matrice visuelle invalide : ${VISIBLE_GLYPH_COUNT} bits requis.`);
        }

        // Cercle extérieur
        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 5 * scale;
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRingRadius + 22 * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Logo central agrandi et remonté pour laisser de l'espace au texte
        const logoPath =
            options.logoPath ||
            payload.logoPath ||
            path.join(__dirname, '../assets/logo_anor_master.png');

        if (fs.existsSync(logoPath)) {
            try {
                const img = await loadImage(logoPath);
                ctx.drawImage(
                    img,
                    centerX - logoRadius,
                    centerY - logoRadius - 28 * scale,
                    logoSize,
                    logoSize
                );
            } catch (error) {
                console.error('[sealRenderer] Erreur lors du chargement du logo :', error);
            }
        }

        // Mires cardinales
        const finderAngles = this.getFinderAngles();

        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.fillStyle = GEOMETRY_COLOR;

        for (let i = 0; i < finderAngles.length; i++) {
            const angle = finderAngles[i];
            const px = centerX + outerRingRadius * Math.cos(angle);
            const py = centerY + outerRingRadius * Math.sin(angle);

            ctx.save();
            ctx.translate(px, py);

            if (i === 0) {
                ctx.lineWidth = 5 * scale;
                ctx.strokeRect(-20, -20, 40, 40);
                ctx.fillRect(-9, -9, 18, 18);
            } else {
                ctx.lineWidth = 4 * scale;
                ctx.strokeRect(-16, -16, 32, 32);
                ctx.fillRect(-6, -6, 12, 12);
            }
            ctx.restore();
        }
        ctx.restore();

        // Glyphes avec effet 2D (ombrage de lecture)
        const positions = this.getVisiblePositions();
        const glyphScale = 1.30;
        const strokeWidth = 4;

        const rings = {
            inner: innerRingRadius,
            outer: outerRingRadius
        };

        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.fillStyle = GEOMETRY_COLOR;

        for (let visibleIndex = 0; visibleIndex < positions.length; visibleIndex++) {
            const pos = positions[visibleIndex];
            const radius = rings[pos.ring];
            const angle = pos.angle;

            const px = centerX + radius * Math.cos(angle);
            const py = centerY + radius * Math.sin(angle);

            const glyphType = this.resolveProtocolGlyph(visibleIndex);
            const glyphDef = GlyphsLibrary.getGlyphDefinition(glyphType);
            const isFilled = visualBits[visibleIndex] === '1';

            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(angle);

            // Effet relief 2D (type QR code)
            ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
            ctx.shadowBlur = 4 * scale;
            ctx.shadowOffsetX = 1.5 * scale;
            ctx.shadowOffsetY = 1.5 * scale;

            drawGlyphFromDefinition(
                ctx,
                glyphType,
                glyphDef,
                isFilled,
                glyphScale,
                strokeWidth
            );

            ctx.restore();
        }
        ctx.restore();

        // Bloc texte agrandi et bien séparé du logo
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const textY = centerY + 148 * scale;

        ctx.font = `bold ${Math.max(34, Math.round(42 * scale))}px sans-serif`;
        ctx.fillStyle = TEXT_PRIMARY_COLOR;
        ctx.fillText(batchText, centerX, textY - 16 * scale);

        ctx.font = `bold ${Math.max(24, Math.round(30 * scale))}px sans-serif`;
        ctx.fillStyle = TEXT_SECONDARY_COLOR;
        ctx.fillText(itemText, centerX, textY + 26 * scale);

        ctx.restore();

        return canvas.toBuffer('image/png');
    }
};

function drawGlyphFromDefinition(ctx, type, def, isFilled, glyphScale = 1, strokeWidth = 4) {
    const width = (def.width || 18) * glyphScale;
    const height = (def.height || 18) * glyphScale;

    ctx.lineWidth = strokeWidth;

    switch (type) {
        case 'square':
        case 'rect':
            if (isFilled) {
                ctx.fillRect(-width / 2, -height / 2, width, height);
            } else {
                ctx.strokeRect(-width / 2, -height / 2, width, height);
            }
            break;

        case 'circle': {
            ctx.beginPath();
            ctx.arc(0, 0, (def.radius || width / 2) * glyphScale, 0, Math.PI * 2);
            if (isFilled) {
                ctx.fill();
            } else {
                ctx.stroke();
            }
            break;
        }

        case 'diamond': {
            ctx.save();
            ctx.rotate((def.rotation || 45) * Math.PI / 180);
            if (isFilled) {
                ctx.fillRect(-width / 2, -height / 2, width, height);
            } else {
                ctx.strokeRect(-width / 2, -height / 2, width, height);
            }
            ctx.restore();
            break;
        }

        case 'plus': {
            const arm = Math.max(strokeWidth * 1.35, width * 0.18);
            if (isFilled) {
                ctx.fillRect(-width / 2, -arm / 2, width, arm);
                ctx.fillRect(-arm / 2, -height / 2, arm, height);
            } else {
                ctx.beginPath();
                ctx.moveTo(-width / 2, 0);
                ctx.lineTo(width / 2, 0);
                ctx.moveTo(0, -height / 2);
                ctx.lineTo(0, height / 2);
                ctx.stroke();
            }
            break;
        }

        default:
            if (isFilled) {
                ctx.fillRect(-width / 2, -height / 2, width, height);
            } else {
                ctx.strokeRect(-width / 2, -height / 2, width, height);
            }
    }
}

module.exports = sealRenderer;