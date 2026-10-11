/**
 * ====================================================================
 * ANOR CHECK
 * SEAL RENDERER V10.0 - CORRECTION STRICTE GEOMETRIE & TEXTE
 * ====================================================================
 */

const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const GlyphsLibrary = require('../library/glyphsLibrary');

const VISUAL_VERSION = 2;
const VISIBLE_GLYPH_COUNT = 24;
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
        
        // 1. LOGO TRES AGRANDI AU CENTRE
        const logoSize = 340; 
        const logoRadius = logoSize / 2;

        // 2. ANNEAUX RAPPROCHÉS AU MAXIMUM
        const outerRingRadius = outerRadius - 35;
        const innerRingRadius = outerRingRadius - 50; // Collé à l'anneau externe

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

    isFinderCollision(angle) {
        for (const targetAngle of this.getFinderAngles()) {
            let diff = Math.abs(angle - targetAngle);
            if (diff > Math.PI) {
                diff = (Math.PI * 2) - diff;
            }
            if (diff < 0.38) {
                return true;
            }
        }
        return false;
    },

    getVisiblePositions() {
        const positions = [];

        // ANNEAU INTERNE : AUCUN GLYPHE AU-DESSUS DU LOGO (Zone Nord exclue entre 200° et 340°)
        const totalInnerSlots = 12;
        for (let i = 0; i < totalInnerSlots; i++) {
            const angle = (i / totalInnerSlots) * Math.PI * 2;
            const deg = (angle * 180 / Math.PI + 360) % 360;

            // Exclusion stricte du haut (au-dessus du logo)
            if (deg >= 210 && deg <= 330) {
                continue;
            }

            // Décalage angulaire quinconce par rapport à l'anneau externe
            const shiftedAngle = angle + (Math.PI / 12);

            positions.push({
                ring: 'inner',
                angle: shiftedAngle,
                index: i
            });
        }

        // ANNEAU EXTERNE (HORS MIRES)
        const totalOuterSlots = 20;
        for (let i = 0; i < totalOuterSlots; i++) {
            const angle = (i / totalOuterSlots) * Math.PI * 2;
            if (!this.isFinderCollision(angle)) {
                positions.push({
                    ring: 'outer',
                    angle,
                    index: i
                });
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

        // Arrière-plan blanc
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
                : (options.masterSerialLabel || '000000 / 2 500');

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

        // 1. CERCLE EXTERNE UNIQUE SOUS LES MIRES
        ctx.save();
        ctx.strokeStyle = GEOMETRY_COLOR;
        ctx.lineWidth = 5 * scale;
        ctx.beginPath();
        ctx.arc(centerX, centerY, outerRingRadius + 22 * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // 2. LOGO CENTRAL MASSIF
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
                    centerY - logoRadius - 25 * scale,
                    logoSize,
                    logoSize
                );
            } catch (error) {
                console.error('[sealRenderer] Erreur lors du chargement du logo :', error);
            }
        }

        // 3. MIRES CARDINALES
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

        // 4. GLYPHES DÉCALÉS EN QUINCONCE
        const positions = this.getVisiblePositions();
        const glyphScale = 1.35;
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

        // 5. TEXTE LIBRE SANS AUCUN ENCADREMENT
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const textY = centerY + 145 * scale;

        // Numéro de lot très grand
        ctx.font = `bold ${Math.max(34, Math.round(42 * scale))}px sans-serif`;
        ctx.fillStyle = TEXT_PRIMARY_COLOR;
        ctx.fillText(batchText, centerX, textY - 14 * scale);

        // Numéro de série très grand
        ctx.font = `bold ${Math.max(24, Math.round(30 * scale))}px sans-serif`;
        ctx.fillStyle = TEXT_SECONDARY_COLOR;
        ctx.fillText(itemText, centerX, textY + 24 * scale);

        ctx.restore();

        return canvas.toBuffer('image/png');
    }
};

function drawGlyphFromDefinition(ctx, type, def, isFilled, glyphScale = 1, strokeWidth = 4) {
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