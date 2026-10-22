/**
 * ====================================================================
 * ANOR CHECK
 * SEAL RENDERER V42.0 - CORRECTIONS EXACTES DES FORMES ET DE L'ORBITE
 * ====================================================================
 */

const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const GlyphsLibrary = require('../library/glyphsLibrary');

const VISUAL_VERSION = 2;
const VISIBLE_GLYPH_COUNT = 28;
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
        return 'square';
    },

    getGeometry(width, height) {
        const outerRadius = Math.min(width, height) / 2 - 15;
        const centerX = width / 2;
        const centerY = height / 2;
        
        const logoSize = 390; 
        const logoRadius = logoSize / 2;

        const outerRingRadius = outerRadius - 20;
        // Orbite rapprochée du centre et dégagée des mires
        const glyphOrbitRadius = outerRingRadius - 62; 

        return {
            centerX,
            centerY,
            outerRadius,
            logoSize,
            logoRadius,
            singleRingRadius: glyphOrbitRadius,
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
        const count = VISIBLE_GLYPH_COUNT;
        const finderAngles = this.getFinderAngles();
        const safetyMargin = (16 * Math.PI) / 180; // Écartement accru des mires

        let validAngles = [];
        const totalSteps = 360;

        for (let i = 0; i < totalSteps; i++) {
            const angle = (i / totalSteps) * Math.PI * 2;
            let isNearFinder = false;

            for (const fAngle of finderAngles) {
                let diff = Math.abs(angle - fAngle);
                while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
                if (diff < safetyMargin) {
                    isNearFinder = true;
                    break;
                }
            }

            if (!isNearFinder) {
                validAngles.push(angle);
            }
        }

        const step = validAngles.length / count;
        for (let i = 0; i < count; i++) {
            const index = Math.min(Math.floor(i * step), validAngles.length - 1);
            positions.push({
                ring: 'single',
                angle: validAngles[index],
                index: i
            });
        }

        return positions;
    },

    async renderSealToBuffer(payload = {}, options = {}) {
        const width = Math.max(400, Math.round(options.width || 800));
        const height = Math.max(400, Math.round(options.height || 800));

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const GEOMETRY_COLOR = options.geometryColor || '#000000';
        const TEXT_PRIMARY_COLOR = options.textColor || '#000000';
        const TEXT_SECONDARY_COLOR = options.subTextColor || '#111111';
        const backgroundColor = options.backgroundColor || '#FFFFFF';

        const geometry = this.getGeometry(width, height);
        const {
            centerX,
            centerY,
            outerRadius,
            logoSize,
            logoRadius,
            singleRingRadius,
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

        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 6 * scale;
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRingRadius + 18 * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        const logoPath =
            options.logoPath ||
            payload.logoPath ||
            path.join(__dirname, '../assets/logo_anor_master.png');

        const logoCenterY = centerY - 55 * scale;

        if (fs.existsSync(logoPath)) {
            try {
                const img = await loadImage(logoPath);
                ctx.drawImage(
                    img,
                    centerX - logoRadius,
                    logoCenterY - logoRadius,
                    logoSize,
                    logoSize
                );
            } catch (error) {
                console.error('[sealRenderer] Erreur lors du chargement du logo :', error);
            }
        }

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
                ctx.fillStyle = backgroundColor;
                ctx.fillRect(-18, -18, 36, 36);
                ctx.fillStyle = GEOMETRY_COLOR;
                ctx.strokeRect(-16, -16, 32, 32);
                ctx.fillRect(-7, -7, 14, 14);
            } else {
                ctx.lineWidth = 4 * scale;
                ctx.fillStyle = backgroundColor;
                ctx.fillRect(-16, -16, 32, 32);
                ctx.fillStyle = GEOMETRY_COLOR;
                ctx.strokeRect(-14, -14, 28, 28);
                ctx.fillRect(-5, -5, 10, 10);
            }
            ctx.restore();
        }
        ctx.restore();

        const positions = this.getVisiblePositions();
        const glyphWidth = 18 * scale;
        const glyphLength = 58 * scale; // Allongement longitudinal important
        const strokeWidth = 4.5;

        ctx.save();

        for (let visibleIndex = 0; visibleIndex < positions.length; visibleIndex++) {
            const pos = positions[visibleIndex];
            const radius = singleRingRadius;
            const angle = pos.angle;

            const px = centerX + radius * Math.cos(angle);
            const py = centerY + radius * Math.sin(angle);

            const glyphType = this.resolveProtocolGlyph(visibleIndex);
            const glyphDef = GlyphsLibrary.getGlyphDefinition(glyphType);
            const isFilled = visualBits[visibleIndex] === '1';

            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(angle + Math.PI / 2);

            ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
            ctx.shadowBlur = 4 * scale;
            ctx.shadowOffsetX = 1.5 * scale;
            ctx.shadowOffsetY = 1.5 * scale;

            drawGlyphExactCorrected2D(
                ctx,
                glyphType,
                glyphDef,
                isFilled,
                glyphWidth,
                glyphLength,
                strokeWidth
            );

            ctx.restore();
        }
        ctx.restore();

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const textY = centerY + 155 * scale;

        ctx.font = `900 ${Math.max(30, Math.round(42 * scale))}px sans-serif`;
        ctx.fillStyle = TEXT_PRIMARY_COLOR;
        ctx.fillText(`${batchText}`, centerX, textY - 14 * scale);

        ctx.font = `900 ${Math.max(26, Math.round(38 * scale))}px sans-serif`;
        ctx.fillStyle = TEXT_SECONDARY_COLOR;
        ctx.fillText(`${itemText}`, centerX, textY + 30 * scale);

        ctx.restore();

        return canvas.toBuffer('image/png');
    }
};

function drawGlyphExactCorrected2D(ctx, type, def, isFilled, w, h, strokeWidth) {
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = isFilled ? '#000000' : '#FFFFFF';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'miter';

    switch (type) {
        case 'square':
        case 'bar':
        case 'rect':
            if (isFilled) {
                ctx.fillRect(-w / 2, -h / 2, w, h);
                ctx.fillStyle = '#222222';
                ctx.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);
            } else {
                ctx.strokeRect(-w / 2, -h / 2, w, h);
            }
            break;

        case 'square_dot':
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.fillStyle = '#000000';
            ctx.fillRect(-w / 4, -h / 4, w / 2, h / 2);
            break;

        case 'square_inner':
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            if (isFilled) {
                ctx.fillStyle = '#000000';
                ctx.fillRect(-w / 3, -h / 3, (2 * w) / 3, (2 * h) / 3);
            } else {
                ctx.strokeRect(-w / 4, -h / 4, w / 2, h / 2);
            }
            break;

        case 'rect_half':
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.fillStyle = '#000000';
            // Remplissage à moitié dans le sens de la longueur (axe vertical h)
            ctx.fillRect(-w / 2, -h / 2, w, h / 2);
            break;

        case 'rect_double':
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.strokeRect(-w / 4, -h / 4, w / 2, h / 2);
            break;

        case 'circle':
            // Cercle parfait (largeur et hauteur égales à w)
            ctx.beginPath();
            ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
            if (isFilled) {
                ctx.fillStyle = '#000000';
                ctx.fill();
            }
            ctx.stroke();
            break;

        case 'circle_dot':
            // Cercle parfait avec point central
            ctx.beginPath();
            ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(0, 0, w / 4, 0, Math.PI * 2);
            ctx.fillStyle = '#000000';
            ctx.fill();
            break;

        case 'diamond':
            ctx.beginPath();
            ctx.moveTo(0, -h / 2);
            ctx.lineTo(w / 2, 0);
            ctx.lineTo(0, h / 2);
            ctx.lineTo(-w / 2, 0);
            ctx.closePath();
            if (isFilled) {
                ctx.fillStyle = '#000000';
                ctx.fill();
            }
            ctx.stroke();
            break;

        case 'diamond_inner':
            ctx.beginPath();
            ctx.moveTo(0, -h / 2);
            ctx.lineTo(w / 2, 0);
            ctx.lineTo(0, h / 2);
            ctx.lineTo(-w / 2, 0);
            ctx.closePath();
            ctx.stroke();
            ctx.fillStyle = '#000000';
            ctx.fillRect(-w / 5, -h / 5, (2 * w) / 5, h * 0.4);
            break;

        case 'plus':
            ctx.beginPath();
            ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0);
            ctx.moveTo(0, -h / 2); ctx.lineTo(0, h / 2);
            ctx.stroke();
            break;

        default:
            if (isFilled) {
                ctx.fillRect(-w / 2, -h / 2, w, h);
            } else {
                ctx.strokeRect(-w / 2, -h / 2, w, h);
            }
    }
}

module.exports = sealRenderer;