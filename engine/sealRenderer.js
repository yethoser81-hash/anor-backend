/**
====================================================================
ANOR CHECK
SEAL RENDERER V6.0

PROTOCOLE VISUEL V1

GLYPHES VISIBLES :

Interne  : 7
Médian   : 24
Externe  : 20

TOTAL    : 51

Les 4 mires cardinales ne comptent PAS
comme glyphes.

Chaque position visible porte 1 bit visuel.

bit 1 = centre bleu
bit 0 = évidement central

IMPORTANT :

La géométrie doit produire EXACTEMENT 51 glyphes.
====================================================================
*/

const {
    createCanvas,
    loadImage
} = require('canvas');

const path =
    require('path');

const fs =
    require('fs');

const crypto =
    require('crypto');

const GlyphsLibrary =
    require('../library/glyphsLibrary');


const VISUAL_VERSION = 1;

const VISIBLE_GLYPH_COUNT = 51;

const INNER_VISIBLE_COUNT = 7;

const MIDDLE_VISIBLE_COUNT = 24;

const OUTER_VISIBLE_COUNT = 20;

const CANONICAL_OUTER_RADIUS = 375;


/**
 * ================================================================
 * RENDERER
 * ================================================================
 */

const sealRenderer = {


    /**
     * ============================================================
     * DÉRIVATION DES 51 BITS
     * ============================================================
     *
     * Le serveur doit utiliser exactement la même règle.
     */

    deriveVisualBits(seed) {

        const digest =
            crypto
                .createHash('sha256')
                .update(
                    `ANOR_VISUAL_V${VISUAL_VERSION}:${String(seed)}`
                )
                .digest();

        let bits = "";

        for (const byte of digest) {

            bits +=
                byte
                    .toString(2)
                    .padStart(8, "0");
        }

        return bits.slice(
            0,
            VISIBLE_GLYPH_COUNT
        );
    },


    /**
     * ============================================================
     * NORMALISER LES BITS
     * ============================================================
     */

    normalizeVisualBits(bits) {

        if (
            typeof bits === "string" &&
            /^[01]{51}$/.test(bits)
        ) {

            return bits;
        }

        return null;
    },


    /**
     * ============================================================
     * RENDU DU SCEAU
     * ============================================================
     */

    async renderSealToBuffer(
        payload = {},
        options = {}
    ) {

        const width =
            options.width || 800;

        const height =
            options.height || 800;

        const canvas =
            createCanvas(
                width,
                height
            );

        const ctx =
            canvas.getContext("2d");

        const centerX =
            width / 2;

        const centerY =
            height / 2;


        const GEOMETRY_COLOR =
            options.geometryColor ||
            "#4A90E2";


        /*
         * ========================================================
         * 1. IDENTIFICATION
         * ========================================================
         */

        const rawBatchName =
            payload.lot ||
            payload.batchNumber ||
            payload.batchName ||
            payload.productName ||
            payload.name ||
            options.batchNumber ||
            options.lot;

        if (!rawBatchName) {

            throw new Error(
                "[sealRenderer] Aucun lot ou nom de produit fourni."
            );
        }


        const normalizedBatchName =
            String(rawBatchName)
                .trim()
                .toUpperCase();


        const batchText =
            normalizedBatchName
                .startsWith("LOT")
                ? normalizedBatchName
                : `LOT ${normalizedBatchName}`;


        /*
         * ========================================================
         * NUMÉRO D'ARTICLE
         * ========================================================
         */

        const rawItemNumber =
            payload.itemNumber ??
            options.itemNumber ??
            payload.serialNumber ??
            options.serial;


        let itemText = "";


        if (
            rawItemNumber !== undefined &&
            rawItemNumber !== null &&
            !options.isMasterSeal &&
            !payload.isMasterSeal
        ) {

            itemText =
                `N° ${rawItemNumber}`;

        } else {

            itemText =
                "DM / 000 000";
        }


        /*
         * ========================================================
         * 2. SIGNATURE / MATRICE VISUELLE
         * ========================================================
         */

        const secureSignature =
            payload.secureSignature ||
            payload.glyph_payload?.secureSignature ||
            null;


        const suppliedVisualBits =
            payload.visualBits ||
            payload.glyph_payload?.visualBits;


        const visualBits =
            this.normalizeVisualBits(
                suppliedVisualBits
            ) ||
            this.deriveVisualBits(
                secureSignature ||
                rawBatchName
            );


        if (!visualBits) {

            throw new Error(
                "[sealRenderer] Impossible de produire les 51 bits visuels."
            );
        }


        if (
            visualBits.length !==
            VISIBLE_GLYPH_COUNT
        ) {

            throw new Error(
                `[sealRenderer] Matrice visuelle invalide : ${visualBits.length}/51.`
            );
        }


        /*
         * ========================================================
         * SEED GÉOMÉTRIQUE
         * ========================================================
         *
         * Utilisé uniquement pour varier les glyphes.
         *
         * Il ne remplace pas visualBits.
         */

        const uniqueSeedSource =
            payload.productId ||
            payload.id ||
            payload.batchId ||
            rawBatchName;


        const hashSeed =
            crypto
                .createHash('sha256')
                .update(
                    `ANOR_SEAL_${uniqueSeedSource}`
                )
                .digest('hex');


        ctx.clearRect(
            0,
            0,
            width,
            height
        );


        /*
         * ========================================================
         * 3. CERCLE EXTÉRIEUR
         * ========================================================
         */

        const outerRadius =
            (
                Math.min(
                    width,
                    height
                ) / 2
            ) - 25;


        ctx.save();

        ctx.strokeStyle =
            GEOMETRY_COLOR;

        ctx.lineWidth =
            5;

        ctx.beginPath();

        ctx.arc(
            centerX,
            centerY,
            outerRadius,
            0,
            Math.PI * 2
        );

        ctx.stroke();

        ctx.restore();


        /*
         * ========================================================
         * 4. LOGO CENTRAL
         * ========================================================
         */

        const logoSize =
            220;

        const logoRadius =
            logoSize / 2;


        const logoPath =
            options.logoPath ||
            payload.logoPath ||
            path.join(
                __dirname,
                "../assets/logo_anor_master.png"
            );


        if (
            fs.existsSync(
                logoPath
            )
        ) {

            try {

                const img =
                    await loadImage(
                        logoPath
                    );

                ctx.drawImage(

                    img,

                    centerX -
                        logoRadius,

                    centerY -
                        logoRadius -
                        35,

                    logoSize,
                    logoSize
                );

            } catch (error) {

                console.error(
                    "[sealRenderer] Erreur logo :",
                    error
                );
            }
        }


        /*
         * ========================================================
         * 5. GÉOMÉTRIE DES ANNEAUX
         * ========================================================
         *
         * IMPORTANT :
         *
         * Interne  = 7
         * Médian   = 24
         * Externe  = 20
         *
         * TOTAL = 51
         */

        const innerRingRadius =
            logoRadius + 45;


        const outerRingRadius =
            outerRadius - 30;


        const midRingRadius =
            (
                innerRingRadius +
                outerRingRadius
            ) / 2;


        /*
         * 4 mires cardinales.
         */

        const finderCardinals = [

            0,

            Math.PI / 2,

            Math.PI,

            (3 * Math.PI) / 2
        ];


        const ringConfigs = [

            {
                name: "inner",

                radius:
                    innerRingRadius,

                count: 12,

                expectedVisible:
                    INNER_VISIBLE_COUNT,

                isInner: true,

                hasFinders: false
            },

            {
                name: "middle",

                radius:
                    midRingRadius,

                count: 24,

                expectedVisible:
                    MIDDLE_VISIBLE_COUNT,

                isInner: false,

                hasFinders: false
            },

            {
                name: "outer",

                radius:
                    outerRingRadius,

                count: 32,

                expectedVisible:
                    OUTER_VISIBLE_COUNT,

                isInner: false,

                hasFinders: true
            }
        ];


        /*
         * ========================================================
         * 6. GLYPHES
         * ========================================================
         */

        const matrixData =
            payload.matrix ||
            payload.glyph_payload?.matrix ||
            [];


        ctx.save();

        ctx.strokeStyle =
            GEOMETRY_COLOR;

        ctx.fillStyle =
            GEOMETRY_COLOR;

        ctx.lineWidth =
            3.5;


        let globalIndexOffset = 0;

        let visibleIndex = 0;


        const scale =
            outerRadius /
            CANONICAL_OUTER_RADIUS;


        const markerSize =
            Math.max(
                4,
                Math.round(
                    8 * scale
                )
            );


        /*
         * --------------------------------------------------------
         * PARCOURIR LES ANNEAUX
         * --------------------------------------------------------
         */

        for (
            const ringConfig
            of ringConfigs
        ) {

            const {
                radius: r,
                count: numPerRing,
                isInner,
                hasFinders,
                expectedVisible
            } = ringConfig;


            let ringVisibleCount = 0;


            for (
                let i = 0;
                i < numPerRing;
                i++
            ) {

                const globalIndex =
                    globalIndexOffset + i;


                const angle =
                    (
                        i /
                        numPerRing
                    ) *
                    Math.PI *
                    2;


                const angleDeg =
                    (
                        angle * 180
                    ) / Math.PI;


                /*
                 * ------------------------------------------------
                 * ANNEAU INTERNE
                 *
                 * 12 positions théoriques.
                 *
                 * On supprime 5 positions :
                 *
                 * indices 1,2,3,4,5
                 *
                 * => 7 visibles.
                 * ------------------------------------------------
                 */

                if (
                    isInner &&
                    angleDeg >= 20 &&
                    angleDeg <= 160
                ) {

                    continue;
                }


                /*
                 * ------------------------------------------------
                 * ANNEAU EXTERNE
                 *
                 * 32 positions théoriques.
                 *
                 * Il faut exactement 20 visibles.
                 *
                 * Donc :
                 *
                 * 32 - 12 = 20
                 *
                 * Les 12 positions supprimées correspondent
                 * à 3 positions autour de chacune des 4 mires.
                 *
                 * Seuil :
                 *
                 * 0.31 rad
                 *
                 * Avec 32 positions :
                 *
                 * espacement ≈ 0.196 rad
                 *
                 * donc chaque mire retire :
                 *
                 * position centrale
                 * + position précédente
                 * + position suivante
                 *
                 * => 3 × 4 = 12.
                 * ------------------------------------------------
                 */

                if (hasFinders) {

                    let collidesWithFinder =
                        false;


                    for (
                        const targetAngle
                        of finderCardinals
                    ) {

                        let diff =
                            Math.abs(
                                angle -
                                targetAngle
                            );


                        if (
                            diff >
                            Math.PI
                        ) {

                            diff =
                                (
                                    Math.PI * 2
                                ) -
                                diff;
                        }


                        if (
                            diff <
                            0.31
                        ) {

                            collidesWithFinder =
                                true;

                            break;
                        }
                    }


                    if (
                        collidesWithFinder
                    ) {

                        continue;
                    }
                }


                /*
                 * ------------------------------------------------
                 * SÉCURITÉ GLOBAL
                 * ------------------------------------------------
                 */

                if (
                    visibleIndex >=
                    VISIBLE_GLYPH_COUNT
                ) {

                    throw new Error(
                        "[sealRenderer] Plus de 51 positions visuelles."
                    );
                }


                /*
                 * ------------------------------------------------
                 * GLYPHE
                 * ------------------------------------------------
                 */

                const hashOffset =
                    (
                        globalIndex * 2
                    ) % 60;


                const hashByte =
                    parseInt(

                        hashSeed.substring(

                            hashOffset,

                            hashOffset + 2
                        ),

                        16

                    ) || globalIndex;


                const item =
                    matrixData[
                        globalIndex
                    ] || {};


                const glyphType =
                    item.glyph ||
                    GlyphsLibrary.resolveGlyph(
                        hashByte
                    );


                const glyphDef =
                    GlyphsLibrary
                        .getGlyphDefinition(
                            glyphType
                        );


                if (!glyphDef) {

                    throw new Error(
                        `Glyphe inconnu : ${glyphType}`
                    );
                }


                /*
                 * Remplissage géométrique.
                 *
                 * Indépendant du bit visuel.
                 */

                const isFilled =
                    item.filled !== undefined
                        ? item.filled
                        : hashByte % 2 === 0;


                /*
                 * BIT VISUEL.
                 *
                 * C'est celui-ci que le téléphone
                 * doit lire.
                 */

                const visualBit =
                    visualBits[
                        visibleIndex
                    ] === "1";


                /*
                 * Position.
                 */

                const px =
                    centerX +
                    r *
                    Math.cos(angle);


                const py =
                    centerY +
                    r *
                    Math.sin(angle);


                /*
                 * ------------------------------------------------
                 * DESSIN DU GLYPHE
                 * ------------------------------------------------
                 */

                ctx.save();

                ctx.translate(
                    px,
                    py
                );

                ctx.rotate(
                    angle
                );


                drawGlyphFromDefinition(

                    ctx,

                    glyphType,

                    glyphDef,

                    isFilled
                );


                /*
                 * ------------------------------------------------
                 * MARQUEUR BINAIRE CENTRAL
                 * ------------------------------------------------
                 *
                 * bit 1 :
                 * centre rempli.
                 *
                 * bit 0 :
                 * centre évidé.
                 */

                if (visualBit) {

                    ctx.globalCompositeOperation =
                        "source-over";

                    ctx.fillStyle =
                        GEOMETRY_COLOR;

                    ctx.fillRect(

                        -markerSize / 2,

                        -markerSize / 2,

                        markerSize,

                        markerSize
                    );

                } else {

                    ctx.globalCompositeOperation =
                        "destination-out";

                    ctx.fillRect(

                        -markerSize / 2,

                        -markerSize / 2,

                        markerSize,

                        markerSize
                    );

                    ctx.globalCompositeOperation =
                        "source-over";
                }


                ctx.restore();


                visibleIndex++;

                ringVisibleCount++;
            }


            /*
             * ------------------------------------------------
             * VÉRIFICATION DE CHAQUE ANNEAU
             * ------------------------------------------------
             */

            if (
                ringVisibleCount !==
                expectedVisible
            ) {

                throw new Error(

                    `[sealRenderer] Anneau ${ringConfig.name} invalide : ` +
                    `${ringVisibleCount}/${expectedVisible} glyphes visibles.`
                );
            }


            globalIndexOffset +=
                numPerRing;
        }


        /*
         * ========================================================
         * VÉRIFICATION FINALE
         * ========================================================
         */

        if (
            visibleIndex !==
            VISIBLE_GLYPH_COUNT
        ) {

            throw new Error(

                `[sealRenderer] Géométrie invalide : ` +
                `${visibleIndex}/${VISIBLE_GLYPH_COUNT} glyphes visibles.`
            );
        }


        /*
         * ========================================================
         * 6.2 MIRES CARDINALES
         * ========================================================
         *
         * Les mires ne consomment AUCUN bit.
         */

        finderCardinals.forEach(
            targetAngle => {

                const px =
                    centerX +
                    outerRingRadius *
                    Math.cos(
                        targetAngle
                    );


                const py =
                    centerY +
                    outerRingRadius *
                    Math.sin(
                        targetAngle
                    );


                ctx.save();

                ctx.translate(
                    px,
                    py
                );


                ctx.lineWidth =
                    4;

                ctx.strokeStyle =
                    GEOMETRY_COLOR;

                ctx.fillStyle =
                    GEOMETRY_COLOR;


                ctx.strokeRect(

                    -15,
                    -15,
                    30,
                    30
                );


                ctx.fillRect(

                    -6,
                    -6,
                    12,
                    12
                );


                ctx.restore();
            }
        );


        ctx.restore();


        /*
         * ========================================================
         * 7. TEXTE
         * ========================================================
         */

        ctx.save();

        ctx.textAlign =
            "center";

        ctx.textBaseline =
            "middle";


        const textY =
            centerY + 115;


        const drawOutlinedText =
            (
                txt,
                x,
                y,
                fontStyle,
                textColor = "#FFFFFF"
            ) => {

                ctx.font =
                    fontStyle;

                ctx.strokeStyle =
                    "#000000";

                ctx.lineWidth =
                    5.5;

                ctx.lineJoin =
                    "round";


                ctx.strokeText(
                    txt,
                    x,
                    y
                );


                ctx.fillStyle =
                    textColor;


                ctx.fillText(
                    txt,
                    x,
                    y
                );
            };


        drawOutlinedText(

            batchText,

            centerX,

            textY - 18,

            "bold 28px sans-serif",

            "#FFFFFF"
        );


        drawOutlinedText(

            itemText,

            centerX,

            textY + 22,

            "bold 26px monospace",

            "#E2E8F0"
        );


        ctx.restore();


        /*
         * ========================================================
         * PNG
         * ========================================================
         */

        return canvas.toBuffer(
            "image/png"
        );
    }
};


/**
 * ================================================================
 * DESSIN DES GLYPHES
 * ================================================================
 */

function drawGlyphFromDefinition(

    ctx,

    type,

    def,

    isFilled

) {

    ctx.beginPath();


    switch (type) {

        /*
         * --------------------------------------------------------
         * CARRÉ
         * --------------------------------------------------------
         */

        case "square":

        case "rect":

            if (isFilled) {

                ctx.fillRect(

                    -def.width / 2,

                    -def.height / 2,

                    def.width,

                    def.height
                );

            } else {

                ctx.strokeRect(

                    -def.width / 2,

                    -def.height / 2,

                    def.width,

                    def.height
                );
            }

            break;


        /*
         * --------------------------------------------------------
         * CERCLE
         * --------------------------------------------------------
         */

        case "circle":

            ctx.arc(

                0,

                0,

                def.radius ||
                (def.width / 2),

                0,

                Math.PI * 2
            );


            if (isFilled) {

                ctx.fill();

            } else {

                ctx.stroke();
            }

            break;


        /*
         * --------------------------------------------------------
         * LOSANGE
         * --------------------------------------------------------
         */

        case "diamond":

            ctx.save();


            ctx.rotate(

                (
                    def.rotation ||
                    45
                ) *
                Math.PI /
                180
            );


            if (isFilled) {

                ctx.fillRect(

                    -def.width / 2,

                    -def.height / 2,

                    def.width,

                    def.height
                );

            } else {

                ctx.strokeRect(

                    -def.width / 2,

                    -def.height / 2,

                    def.width,

                    def.height
                );
            }


            ctx.restore();

            break;


        /*
         * --------------------------------------------------------
         * PLUS
         * --------------------------------------------------------
         */

        case "plus": {

            const hW =
                def.width / 2;

            const hH =
                def.height / 2;


            ctx.moveTo(
                -hW,
                0
            );

            ctx.lineTo(
                hW,
                0
            );


            ctx.moveTo(
                0,
                -hH
            );

            ctx.lineTo(
                0,
                hH
            );


            ctx.stroke();

            break;
        }


        /*
         * --------------------------------------------------------
         * FALLBACK
         * --------------------------------------------------------
         */

        default:

            if (isFilled) {

                ctx.fillRect(

                    -def.width / 2,

                    -def.height / 2,

                    def.width,

                    def.height
                );

            } else {

                ctx.strokeRect(

                    -def.width / 2,

                    -def.height / 2,

                    def.width,

                    def.height
                );
            }

            break;
    }
}


/**
====================================================================
EXPORT
====================================================================
*/

module.exports =
    sealRenderer;