/**
 * ====================================================================
 * ANOR CHECK
 * SEAL RENDERER V7.5 - 2 ANNEAUX OPTIMISÉS & ORIENTATION NORD
 * ====================================================================
 */

const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const GlyphsLibrary = require('../library/glyphsLibrary');

const VISUAL_VERSION = 1;
const VISIBLE_GLYPH_COUNT = 36; // 16 sur l'anneau interne + 20 sur l'anneau externe
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
        const outerRadius = Math.min(width, height) / 2 - 25;
        const centerX = width / 2;
        const centerY = height / 2;
        
        const logoSize = 210; // Logo agrandi au centre
        const logoRadius = logoSize / 2;

        const innerRingRadius = logoRadius + 42; 
        const outerRingRadius = outerRadius - 38;

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

    getVisiblePositions() {
        const positions = [];

        // Anneau Interne : 16 glyphes (plus grands)
        for (let i = 0; i < 16; i++) {
            positions.push({
                ring: 'inner',
                ringPosition: i,
                theoreticalCount: 16
            });
        }

        // Anneau Externe : 20 glyphes (espacés et massifs)
        for (let i = 0; i < 20; i++) {
            positions.push({
                ring: 'outer',
                ringPosition: i,
                theoreticalCount: 20
            });
        }

        if (positions.length !== VISIBLE_GLYPH_COUNT) {
            throw new Error(
                `[sealRenderer] Géométrie protocolaire invalide : ${positions.length}/${VISIBLE_GLYPH_COUNT}.`
            );
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
        const enable2DEffect = options.enable2DEffect !== false;

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

        ctx.save();
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();

        const rawBatchName =
            payload.lot ||
            payload.batchNumber ||
            payload.batchName ||
            payload.productName ||
            payload.name ||
            options.batchNumber ||
            options.lot;

        if (!rawBatchName) {
            throw new Error('[sealRenderer] Aucun lot ou nom de produit fourni.');
        }

        const normalizedBatchName = String(rawBatchName).trim().toUpperCase();
        const batchText = normalizedBatchName.startsWith('LOT')
            ? normalizedBatchName
            : `LOT ${normalizedBatchName}`;

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
                ? `${rawItemNumber}`
                : (options.masterSerialLabel || '000 000');

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

        if (enable2DEffect) {
            ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
            ctx.shadowBlur = 10 * scale;
            ctx.shadowOffsetX = 3 * scale;
            ctx.shadowOffsetY = 4 * scale;
        }

        // Cercle extérieur
        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 6 * scale;
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Logo central
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
                    centerY - logoRadius,
                    logoSize,
                    logoSize
                );
            } catch (error) {
                console.error('[sealRenderer] Erreur lors du chargement du logo :', error);
            }
        }

        // Rendu des Glyphes sur 2 anneaux
        const positions = this.getVisiblePositions();
        const glyphScale = 1.45; // Glyphes plus grands pour une visibilité nette à 2,5cm
        const strokeWidth = 5;

        const rings = {
            inner: innerRingRadius,
            outer: outerRingRadius
        };

        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.fillStyle = GEOMETRY_COLOR;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (let visibleIndex = 0; visibleIndex < positions.length; visibleIndex++) {
            const position = positions[visibleIndex];
            const radius = rings[position.ring];
            const angle =
                (position.ringPosition / position.theoreticalCount) *
                Math.PI * 2;

            const px = centerX + radius * Math.cos(angle);
            const py = centerY + radius * Math.sin(angle);

            const glyphType = this.resolveProtocolGlyph(visibleIndex);
            const glyphDef = GlyphsLibrary.getGlyphDefinition(glyphType);
            const isFilled = visualBits[visibleIndex] === '1';

            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(angle);

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

        ctx.shadowColor = 'transparent';

        // ------------------------------------------------------------
        // MIRE NORD ASYMÉTRIQUE (ORIENTATION DE LECTURE INSTANTANÉE)
        // Positionnée exactement à 12h (angle -PI/2) pour décodage < 3s
        // ------------------------------------------------------------
        const northAngle = -Math.PI / 2;
        const northPx = centerX + outerRingRadius * Math.cos(northAngle);
        const northPy = centerY + outerRingRadius * Math.sin(northAngle);

        ctx.save();
        ctx.translate(northPx, northPy);
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.fillStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 6 * scale;
        // Double carré superposé distinctif pour indiquer le Nord absolu
        ctx.strokeRect(-22, -22, 44, 44);
        ctx.fillRect(-10, -10, 20, 20);
        ctx.restore();

        // Autres mires cardinales (Est, Sud, Ouest)
        const otherAngles = [0, Math.PI / 2, Math.PI];
        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.fillStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 4 * scale;

        for (const targetAngle of otherAngles) {
            const px = centerX + outerRingRadius * Math.cos(targetAngle);
            const py = centerY + outerRingRadius * Math.sin(targetAngle);

            ctx.save();
            ctx.translate(px, py);
            ctx.strokeRect(-16, -16, 32, 32);
            ctx.fillRect(-6, -6, 12, 12);
            ctx.restore();
        }
        ctx.restore();

        // ------------------------------------------------------------
        // BLOC TEXTE ÉPURÉ (SANS "LOT" NI "SÉRIE", CHIFFRES AGRANDIS)
        // ------------------------------------------------------------
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const textY = centerY + 135 * scale; 
        const boxWidth = 310 * scale;
        const boxHeight = 62 * scale;

        if (enable2DEffect) {
            ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
            ctx.shadowBlur = 6 * scale;
            ctx.shadowOffsetX = 2 * scale;
            ctx.shadowOffsetY = 3 * scale;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.roundRect(centerX - boxWidth / 2, textY - boxHeight / 2, boxWidth, boxHeight, 12 * scale);
        ctx.fill();
        
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2.5 * scale;
        ctx.stroke();

        const drawOutlinedText = (text, x, y, font, textColor) => {
            ctx.font = font;
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = Math.max(4, 5 * scale);
            ctx.lineJoin = 'round';
            ctx.strokeText(text, x, y);
            ctx.fillStyle = textColor;
            ctx.fillText(text, x, y);
        };

        // Code de lot en taille maximale (sans le mot "LOT")
        drawOutlinedText(
            normalizedBatchName.replace(/^LOT\s*/, ''),
            centerX,
            textY - 11 * scale,
            `bold ${Math.max(26, Math.round(32 * scale))}px sans-serif`,
            TEXT_PRIMARY_COLOR
        );

        // Numéro de série épuré
        drawOutlinedText(
            itemText,
            centerX,
            textY + 16 * scale,
            `bold ${Math.max(20, Math.round(24 * scale))}px sans-serif`,
            TEXT_SECONDARY_COLOR
        );

        ctx.restore();

        return canvas.toBuffer('image/png');
    }
};

function drawGlyphFromDefinition(ctx, type, def, isFilled, glyphScale = 1, strokeWidth = 5) {
    const width = def.width * glyphScale;
    const height = def.height * glyphScale;

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
            ctx.arc(0, 0, (def.radius || def.width / 2) * glyphScale, 0, Math.PI * 2);
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