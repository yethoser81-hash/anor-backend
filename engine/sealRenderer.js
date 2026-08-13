/**
 * ====================================================================
 * ANOR CHECK
 * SEAL DECODER V6.0
 *
 * CONTRAT AVEC sealRenderer V6.0
 *
 * Anneaux :
 *   Interne  : 12 positions -> 7 visibles
 *   Médian   : 24 positions -> 24 visibles
 *   Externe  : 32 positions -> 20 visibles
 *
 * TOTAL GLYPHES LISIBLES : 51
 *
 * PROTOCOLE VISUEL :
 *
 *   bit 1 = marqueur central bleu/plein
 *   bit 0 = marqueur central évidé
 *
 * IMPORTANT :
 *
 * Le glyphe géométrique et le bit visuel sont DEUX informations
 * différentes.
 *
 * Le renderer dessine d'abord le glyphe puis écrit le bit au centre.
 *
 * Le decoder NE DOIT DONC PAS utiliser la densité du glyphe
 * pour déterminer le bit.
 *
 * Il mesure uniquement la zone du marqueur central.
 *
 * ====================================================================
 */

class SealDecoder {

    static TYPES = [
        "square",
        "rect",
        "circle",
        "diamond",
        "plus"
    ];


    static GEOMETRY = {

        inner: 7,

        middle: 24,

        outer: 20,

        total: 51
    };


    static PROTOCOL = {

        /*
         * ------------------------------------------------------------
         * FORMAT DE RÉFÉRENCE
         * ------------------------------------------------------------
         */

        referenceSize: 800,

        canonicalOuterRadius: 375,

        logoSize: 220,

        logoOffsetY: -35,

        logoSafetyMargin: 12,


        /*
         * ------------------------------------------------------------
         * COULEUR DU SCEAU
         * ------------------------------------------------------------
         */

        blueThreshold: 70,


        /*
         * ------------------------------------------------------------
         * UPSCALE
         * ------------------------------------------------------------
         */

        upscaleFactor: 4,

        maxWorkingSize: 2400,


        /*
         * ------------------------------------------------------------
         * MARQUEUR CENTRAL
         * ------------------------------------------------------------
         *
         * Dans sealRenderer :
         *
         * markerSize =
         *     Math.max(
         *         4,
         *         Math.round(8 * scale)
         *     );
         *
         * Le diamètre canonique est donc environ 8 px.
         *
         * Le rayon canonique réel du marqueur est donc environ 4 px.
         *
         * On ne mesure plus 10 ou 12.5 px comme dans l'ancien decoder.
         */

        markerSizeCanonical: 8,

        markerRadiusCanonical: 4,

        markerCoreRatio: 0.68,

        markerProbeRatio: 1.05,

        markerThreshold: 0.18,

        markerStrongThreshold: 0.42,

        minimumMarkerSamples: 8,


        /*
         * ------------------------------------------------------------
         * TEXTE
         * ------------------------------------------------------------
         */

        text: {

            lot: {

                centerX: 400,

                centerY: 500,

                width: 280,

                height: 42
            },


            serie: {

                centerX: 400,

                centerY: 545,

                width: 250,

                height: 40
            },


            searchMargin: 35
        },


        /*
         * ------------------------------------------------------------
         * OCR
         * ------------------------------------------------------------
         */

        ocr: {

            enabled: true,

            language: "eng",

            psm: 7
        }

    };


    /**
     * =================================================================
     * DÉCODAGE PRINCIPAL
     * =================================================================
     */

    static async decodeFromImage(
        canvas,
        options = {}
    ) {

        if (!canvas) {

            return {

                success: false,

                status:
                    "INVALID_IMAGE",

                error:
                    "Canvas absent."
            };
        }


        try {

            const width =
                canvas.width;

            const height =
                canvas.height;


            if (
                !width ||
                !height
            ) {

                return {

                    success: false,

                    status:
                        "INVALID_IMAGE",

                    error:
                        "Image vide."
                };
            }


            /**
             * =========================================================
             * 1. IMAGE DE TRAVAIL
             * =========================================================
             */

            const working =
                this.createWorkingCanvas(
                    canvas,
                    options
                );


            if (!working) {

                return {

                    success: false,

                    status:
                        "WORKING_IMAGE_ERROR",

                    error:
                        "Impossible de préparer l'image."
                };
            }


            const workingCanvas =
                working.canvas;


            const workingScale =
                working.scale;


            const workingCtx =
                workingCanvas.getContext(
                    "2d",
                    {
                        willReadFrequently:
                            true
                    }
                );


            if (!workingCtx) {

                return {

                    success: false,

                    status:
                        "CANVAS_CONTEXT_ERROR",

                    error:
                        "Contexte Canvas indisponible."
                };
            }


            const imageData =
                workingCtx.getImageData(
                    0,
                    0,
                    workingCanvas.width,
                    workingCanvas.height
                );


            const data =
                imageData.data;


            const workWidth =
                workingCanvas.width;


            const workHeight =
                workingCanvas.height;


            /**
             * =========================================================
             * 2. DÉTECTION DU SCEAU
             * =========================================================
             */

            const sealBounds =
                this.detectSealBounds(
                    data,
                    workWidth,
                    workHeight
                );


            if (!sealBounds) {

                return {

                    success: false,

                    status:
                        "SEAL_NOT_DETECTED",

                    error:
                        "Aucun sceau ANOR détectable."
                };
            }


            let centerX =
                sealBounds.centerX;


            let centerY =
                sealBounds.centerY;


            let outerRadius =
                sealBounds.radius;


            /**
             * =========================================================
             * 3. MIRES
             * =========================================================
             */

            const finderResult =
                this.detectFinders(
                    data,
                    workWidth,
                    workHeight,
                    centerX,
                    centerY,
                    outerRadius
                );


            /*
             * Les mires servent de validation.
             *
             * On ne modifie pas artificiellement le centre ici :
             * le renderer utilise toujours le centre géométrique
             * du canvas.
             */

            if (
                finderResult &&
                finderResult.valid
            ) {

                centerX =
                    finderResult.centerX;

                centerY =
                    finderResult.centerY;

                outerRadius =
                    finderResult.radius;
            }


            /**
             * =========================================================
             * 4. GÉOMÉTRIE
             * =========================================================
             */

            const scale =
                outerRadius /
                this.PROTOCOL.canonicalOuterRadius;


            const logoSize =
                this.PROTOCOL.logoSize *
                scale;


            const logoRadius =
                logoSize / 2;


            const innerRingRadius =
                logoRadius +
                45 * scale;


            const outerRingRadius =
                outerRadius -
                30 * scale;


            const midRingRadius =
                (
                    innerRingRadius +
                    outerRingRadius
                ) / 2;


            /**
             * =========================================================
             * 5. ZONE CENTRALE
             * =========================================================
             */

            const centralZone = {

                centerX,

                centerY:
                    centerY +
                    (
                        this.PROTOCOL.logoOffsetY *
                        scale
                    ),

                radius:
                    logoRadius +
                    (
                        this.PROTOCOL.logoSafetyMargin *
                        scale
                    )
            };


            /**
             * =========================================================
             * 6. LECTURE DES 51 GLYPHES
             * =========================================================
             */

            const detectedMatrix = [];


            const finderCardinals = [

                0,

                Math.PI / 2,

                Math.PI,

                (3 * Math.PI) / 2

            ];


            const ringConfigs = [

                {

                    name:
                        "inner",

                    radius:
                        innerRingRadius,

                    count:
                        12,

                    isInner:
                        true,

                    hasFinders:
                        false
                },


                {

                    name:
                        "middle",

                    radius:
                        midRingRadius,

                    count:
                        24,

                    isInner:
                        false,

                    hasFinders:
                        false
                },


                {

                    name:
                        "outer",

                    radius:
                        outerRingRadius,

                    count:
                        32,

                    isInner:
                        false,

                    hasFinders:
                        true
                }

            ];


            let globalIndexOffset = 0;

            let visibleIndex = 0;


            for (
                const ringConfig
                of ringConfigs
            ) {

                const {

                    name,

                    radius,

                    count,

                    isInner,

                    hasFinders

                } = ringConfig;


                for (
                    let i = 0;
                    i < count;
                    i++
                ) {

                    const globalIndex =
                        globalIndexOffset +
                        i;


                    const angle =
                        (
                            i /
                            count
                        ) *
                        Math.PI *
                        2;


                    const angleDeg =
                        angle *
                        180 /
                        Math.PI;


                    /**
                     * -------------------------------------------------
                     * ANNEAU INTERNE
                     * -------------------------------------------------
                     *
                     * Renderer :
                     *
                     * 12 positions
                     * indices/angles 20° → 160°
                     * ignorés
                     * = 7 visibles
                     */

                    if (
                        isInner &&
                        angleDeg >= 20 &&
                        angleDeg <= 160
                    ) {

                        continue;
                    }


                    /**
                     * -------------------------------------------------
                     * ANNEAU EXTERNE
                     * -------------------------------------------------
                     *
                     * Renderer :
                     *
                     * diff < 0.31
                     *
                     * IMPORTANT :
                     * on utilise exactement la même valeur.
                     */

                    if (hasFinders) {

                        let collides =
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

                                collides =
                                    true;

                                break;
                            }
                        }


                        if (collides) {

                            continue;
                        }
                    }


                    /**
                     * -------------------------------------------------
                     * POSITION
                     * -------------------------------------------------
                     */

                    const px =
                        centerX +
                        radius *
                        Math.cos(angle);


                    const py =
                        centerY +
                        radius *
                        Math.sin(angle);


                    /**
                     * -------------------------------------------------
                     * LECTURE DU MARQUEUR CENTRAL
                     * -------------------------------------------------
                     *
                     * IMPORTANT :
                     *
                     * On ne mesure PAS la forme du glyphe.
                     *
                     * On mesure uniquement le centre où le renderer
                     * place le bit visuel.
                     */

                    const measurement =
                        this.measureMarker(
                            data,
                            workWidth,
                            workHeight,
                            px,
                            py,
                            scale
                        );


                    const bit =
                        measurement.bit;


                    detectedMatrix.push({

                        index:
                            globalIndex,

                        visibleIndex,

                        ring:
                            name,

                        ringPosition:
                            i,

                        angle,

                        x:
                            px,

                        y:
                            py,

                        /*
                         * Compatibilité avec l'ancien format.
                         */

                        density:
                            measurement.density,

                        blueDensity:
                            measurement.blueDensity,

                        markerConfidence:
                            measurement.markerConfidence,

                        markerRadius:
                            measurement.markerRadius,

                        coreRadius:
                            measurement.coreRadius,

                        sampleCount:
                            measurement.totalPixels,

                        filled:
                            bit === 1,

                        bit

                    });


                    visibleIndex++;
                }


                globalIndexOffset +=
                    count;
            }


            /**
             * =========================================================
             * 7. VALIDATION 51 GLYPHES
             * =========================================================
             */

            const innerCount =
                detectedMatrix.filter(
                    x =>
                        x.ring === "inner"
                ).length;


            const middleCount =
                detectedMatrix.filter(
                    x =>
                        x.ring === "middle"
                ).length;


            const outerCount =
                detectedMatrix.filter(
                    x =>
                        x.ring === "outer"
                ).length;


            if (
                innerCount !== 7 ||
                middleCount !== 24 ||
                outerCount !== 20
            ) {

                return {

                    success: false,

                    status:
                        "INVALID_GEOMETRY",

                    error:
                        "Structure du sceau invalide.",

                    expected:
                        {
                            ...this.GEOMETRY
                        },

                    detected: {

                        inner:
                            innerCount,

                        middle:
                            middleCount,

                        outer:
                            outerCount,

                        total:
                            detectedMatrix.length
                    },

                    geometry: {

                        centerX,

                        centerY,

                        outerRadius,

                        innerRingRadius,

                        midRingRadius,

                        outerRingRadius
                    }
                };
            }


            /**
             * =========================================================
             * 8. SIGNATURE VISUELLE
             * =========================================================
             */

            const visualBits =
                detectedMatrix
                    .map(
                        item =>
                            item.bit === 1
                                ? "1"
                                : "0"
                    )
                    .join("");


            if (
                !/^[01]{51}$/.test(
                    visualBits
                )
            ) {

                return {

                    success: false,

                    status:
                        "INVALID_VISUAL_BITS",

                    error:
                        "Matrice visuelle invalide.",

                    visualBits
                };
            }


            const visualSignature =
                `ANOR51:${visualBits}`;


            /**
             * =========================================================
             * 9. LECTURE LOT + SÉRIE
             * =========================================================
             */

            const textResult =
                await this.decodeLotAndSerie(
                    workingCanvas,
                    {
                        centerX,
                        centerY,
                        outerRadius
                    },
                    options
                );


            /**
             * =========================================================
             * 10. CONFIANCE
             * =========================================================
             */

            const confidence =
                calculateDecoderConfidence(
                    detectedMatrix,
                    finderResult,
                    textResult
                );


            /**
             * =========================================================
             * 11. RÉSULTAT FINAL
             * =========================================================
             */

            return {

                success:
                    true,

                status:
                    "GLYPHS_READ",


                geometry: {

                    inner:
                        7,

                    middle:
                        24,

                    outer:
                        20,

                    total:
                        51,

                    centerX,

                    centerY,

                    outerRadius,

                    innerRingRadius,

                    midRingRadius,

                    outerRingRadius
                },


                centralZone,


                workingScale,


                finderDetection:
                    finderResult || {
                        valid:
                            false
                    },


                matrix:
                    detectedMatrix,


                visualBits,


                visualSignature,


                /*
                 * -----------------------------------------------------
                 * IDENTIFIANTS IMPRIMÉS
                 * -----------------------------------------------------
                 */

                lot:
                    textResult.lot,

                serie:
                    textResult.serie,

                lotRaw:
                    textResult.lotRaw,

                serieRaw:
                    textResult.serieRaw,

                textConfidence:
                    textResult.confidence,

                textStatus:
                    textResult.status,


                confidence

            };


        } catch (error) {

            console.error(
                "❌ SealDecoder:",
                error
            );


            return {

                success:
                    false,

                status:
                    "DECODER_ERROR",

                error:
                    error &&
                    error.message
                        ? error.message
                        : String(error)
            };
        }
    }


    /**
     * =================================================================
     * OCR LOT + SÉRIE
     * =================================================================
     */

    static async decodeLotAndSerie(
        workingCanvas,
        geometry,
        options = {}
    ) {

        const result = {

            lot:
                null,

            serie:
                null,

            lotRaw:
                null,

            serieRaw:
                null,

            confidence:
                0,

            status:
                "OCR_NOT_AVAILABLE"
        };


        if (
            options.ocr === false ||
            this.PROTOCOL.ocr.enabled === false
        ) {

            result.status =
                "OCR_DISABLED";

            return result;
        }


        /*
         * Tesseract est optionnel.
         */

        if (
            typeof Tesseract ===
            "undefined"
        ) {

            return result;
        }


        try {

            const scale =
                geometry.outerRadius /
                this.PROTOCOL.canonicalOuterRadius;


            const lotImage =
                this.createTextRegion(
                    workingCanvas,
                    geometry,
                    this.PROTOCOL.text.lot,
                    scale
                );


            const serieImage =
                this.createTextRegion(
                    workingCanvas,
                    geometry,
                    this.PROTOCOL.text.serie,
                    scale
                );


            const language =
                options.ocrLanguage ||
                this.PROTOCOL.ocr.language;


            const lotOCR =
                await Tesseract.recognize(
                    lotImage,
                    language,
                    {
                        tessedit_pageseg_mode:
                            this.PROTOCOL.ocr.psm
                    }
                );


            const serieOCR =
                await Tesseract.recognize(
                    serieImage,
                    language,
                    {
                        tessedit_pageseg_mode:
                            this.PROTOCOL.ocr.psm
                    }
                );


            const lotRaw =
                this.cleanOCR(
                    lotOCR?.data?.text
                );


            const serieRaw =
                this.cleanOCR(
                    serieOCR?.data?.text
                );


            result.lotRaw =
                lotRaw ||
                null;


            result.serieRaw =
                serieRaw ||
                null;


            result.lot =
                this.extractLot(
                    lotRaw
                );


            result.serie =
                this.extractSerie(
                    serieRaw
                );


            const lotConfidence =
                Number(
                    lotOCR?.data?.confidence ||
                    0
                );


            const serieConfidence =
                Number(
                    serieOCR?.data?.confidence ||
                    0
                );


            result.confidence =
                Math.round(
                    (
                        lotConfidence +
                        serieConfidence
                    ) / 2
                );


            result.status =
                (
                    result.lot ||
                    result.serie
                )
                    ? "TEXT_READ"
                    : "TEXT_NOT_READ";


            return result;


        } catch (error) {

            console.warn(
                "[SealDecoder] OCR LOT/SÉRIE :",
                error
            );


            result.status =
                "OCR_ERROR";


            return result;
        }
    }


    /**
     * =================================================================
     * CRÉATION ZONE TEXTE
     * =================================================================
     */

    static createTextRegion(
        sourceCanvas,
        geometry,
        config,
        scale
    ) {

        const canonicalScale =
            geometry.outerRadius /
            this.PROTOCOL.canonicalOuterRadius;


        const cx =
            geometry.centerX;


        const canonicalCenterY =
            geometry.centerY;


        const x =
            cx -
            (
                config.width *
                canonicalScale
            ) / 2;


        const y =
            canonicalCenterY +
            (
                config.centerY -
                400
            ) *
            canonicalScale -
            (
                config.height *
                canonicalScale
            ) / 2;


        const width =
            Math.max(
                40,
                Math.round(
                    config.width *
                    canonicalScale
                )
            );


        const height =
            Math.max(
                20,
                Math.round(
                    config.height *
                    canonicalScale
                )
            );


        const margin =
            Math.round(
                this.PROTOCOL.text.searchMargin *
                canonicalScale
            );


        const crop =
            document.createElement(
                "canvas"
            );


        crop.width =
            width +
            margin * 2;


        crop.height =
            height +
            margin * 2;


        const ctx =
            crop.getContext(
                "2d"
            );


        if (!ctx) {

            return crop;
        }


        /*
         * Fond blanc pour l'OCR.
         */

        ctx.fillStyle =
            "#FFFFFF";


        ctx.fillRect(
            0,
            0,
            crop.width,
            crop.height
        );


        /*
         * Source correctement bornée.
         */

        const sourceX =
            Math.max(
                0,
                Math.round(
                    x - margin
                )
            );


        const sourceY =
            Math.max(
                0,
                Math.round(
                    y - margin
                )
            );


        const sourceWidth =
            Math.min(
                sourceCanvas.width -
                sourceX,

                width +
                margin * 2
            );


        const sourceHeight =
            Math.min(
                sourceCanvas.height -
                sourceY,

                height +
                margin * 2
            );


        if (
            sourceWidth > 0 &&
            sourceHeight > 0
        ) {

            ctx.drawImage(

                sourceCanvas,

                sourceX,
                sourceY,
                sourceWidth,
                sourceHeight,

                0,
                0,
                sourceWidth,
                sourceHeight
            );
        }


        /*
         * Agrandissement supplémentaire.
         */

        const enlarged =
            document.createElement(
                "canvas"
            );


        const textScale = 2;


        enlarged.width =
            crop.width *
            textScale;


        enlarged.height =
            crop.height *
            textScale;


        const enlargedCtx =
            enlarged.getContext(
                "2d"
            );


        if (!enlargedCtx) {

            return crop;
        }


        enlargedCtx.imageSmoothingEnabled =
            true;


        enlargedCtx.imageSmoothingQuality =
            "high";


        enlargedCtx.drawImage(
            crop,
            0,
            0,
            enlarged.width,
            enlarged.height
        );


        return enlarged;
    }


    /**
     * =================================================================
     * NETTOYAGE OCR
     * =================================================================
     */

    static cleanOCR(text) {

        if (!text) {

            return "";
        }


        return String(text)

            .replace(
                /[\r\n]+/g,
                " "
            )

            .replace(
                /\s+/g,
                " "
            )

            .trim();
    }


    /**
     * =================================================================
     * EXTRACTION LOT
     * =================================================================
     */

    static extractLot(text) {

        if (!text) {

            return null;
        }


        const normalized =
            text
                .toUpperCase()
                .replace(
                    /O/g,
                    "0"
                );


        /*
         * Exemple :
         *
         * LOT 41U-2026
         */

        const match =
            normalized.match(
                /LOT\s*[:\/\-]?\s*([A-Z0-9][A-Z0-9\-]{2,})/
            );


        if (match) {

            return match[1];
        }


        /*
         * Fallback.
         */

        const fallback =
            normalized.match(
                /\b[A-Z0-9]{2,8}-[A-Z0-9]{2,8}\b/
            );


        return fallback
            ? fallback[0]
            : null;
    }


    /**
     * =================================================================
     * EXTRACTION SÉRIE
     * =================================================================
     */

    static extractSerie(text) {

        if (!text) {

            return null;
        }


        const normalized =
            text
                .toUpperCase()
                .replace(
                    /O/g,
                    "0"
                );


        /*
         * Exemple :
         *
         * DM / 000 000
         */

        const labeled =
            normalized.match(
                /(?:DM|SERIE|S[ÉE]RIE)\s*[\/:\-]?\s*([A-Z0-9][A-Z0-9\s\-]{1,})/
            );


        if (labeled) {

            return labeled[1]
                .trim()
                .replace(
                    /\s+/g,
                    " "
                );
        }


        /*
         * Séquence numérique.
         */

        const numeric =
            normalized.match(
                /\b\d{2,}(?:\s+\d{2,})*\b/
            );


        return numeric
            ? numeric[0]
            : null;
    }


    /**
     * =================================================================
     * IMAGE DE TRAVAIL
     * =================================================================
     */

    static createWorkingCanvas(
        sourceCanvas,
        options = {}
    ) {

        const sourceWidth =
            sourceCanvas.width;


        const sourceHeight =
            sourceCanvas.height;


        let scale =
            Number(
                options.upscaleFactor ||
                this.PROTOCOL.upscaleFactor
            );


        if (
            !Number.isFinite(scale) ||
            scale < 1
        ) {

            scale = 1;
        }


        let targetWidth =
            Math.round(
                sourceWidth *
                scale
            );


        let targetHeight =
            Math.round(
                sourceHeight *
                scale
            );


        const maxSize =
            options.maxWorkingSize ||
            this.PROTOCOL.maxWorkingSize;


        const largest =
            Math.max(
                targetWidth,
                targetHeight
            );


        if (
            largest >
            maxSize
        ) {

            const correction =
                maxSize /
                largest;


            targetWidth =
                Math.round(
                    targetWidth *
                    correction
                );


            targetHeight =
                Math.round(
                    targetHeight *
                    correction
                );


            scale *=
                correction;
        }


        const workCanvas =
            document.createElement(
                "canvas"
            );


        workCanvas.width =
            Math.max(
                1,
                targetWidth
            );


        workCanvas.height =
            Math.max(
                1,
                targetHeight
            );


        const workCtx =
            workCanvas.getContext(
                "2d",
                {
                    willReadFrequently:
                        true
                }
            );


        if (!workCtx) {

            return null;
        }


        workCtx.imageSmoothingEnabled =
            true;


        workCtx.imageSmoothingQuality =
            "high";


        workCtx.drawImage(
            sourceCanvas,
            0,
            0,
            workCanvas.width,
            workCanvas.height
        );


        return {

            canvas:
                workCanvas,

            scale
        };
    }


    /**
     * =================================================================
     * DÉTECTION DU SCEAU
     * =================================================================
     */

    static detectSealBounds(
        data,
        width,
        height
    ) {

        let minX =
            width;


        let minY =
            height;


        let maxX =
            -1;


        let maxY =
            -1;


        let count =
            0;


        const step =
            Math.max(
                1,
                Math.floor(
                    Math.min(
                        width,
                        height
                    ) / 700
                )
            );


        for (
            let y = 0;
            y < height;
            y += step
        ) {

            for (
                let x = 0;
                x < width;
                x += step
            ) {

                const idx =
                    (
                        y *
                        width +
                        x
                    ) * 4;


                const r =
                    data[idx];


                const g =
                    data[idx + 1];


                const b =
                    data[idx + 2];


                const a =
                    data[idx + 3];


                if (
                    a < 40
                ) {

                    continue;
                }


                if (
                    !this.isSealBlue(
                        r,
                        g,
                        b
                    )
                ) {

                    continue;
                }


                minX =
                    Math.min(
                        minX,
                        x
                    );


                minY =
                    Math.min(
                        minY,
                        y
                    );


                maxX =
                    Math.max(
                        maxX,
                        x
                    );


                maxY =
                    Math.max(
                        maxY,
                        y
                    );


                count++;
            }
        }


        if (
            count < 30 ||
            maxX < minX ||
            maxY < minY
        ) {

            return null;
        }


        const boxWidth =
            maxX -
            minX;


        const boxHeight =
            maxY -
            minY;


        const diameter =
            Math.max(
                boxWidth,
                boxHeight
            );


        if (
            diameter < 30
        ) {

            return null;
        }


        return {

            minX,

            minY,

            maxX,

            maxY,

            centerX:
                (
                    minX +
                    maxX
                ) / 2,

            centerY:
                (
                    minY +
                    maxY
                ) / 2,

            radius:
                diameter / 2,

            pixelCount:
                count
        };
    }


    /**
     * =================================================================
     * DÉTECTION BLEUE
     * =================================================================
     */

    static isSealBlue(
        r,
        g,
        b
    ) {

        const luminance =
            0.299 * r +
            0.587 * g +
            0.114 * b;


        const blueDominance =
            b - r;


        const saturation =
            Math.max(
                r,
                g,
                b
            ) -
            Math.min(
                r,
                g,
                b
            );


        return (

            blueDominance >= 20 &&

            saturation >= 25 &&

            b >=
                this.PROTOCOL.blueThreshold &&

            luminance <= 250
        );
    }


    /**
     * =================================================================
     * DÉTECTION DES MIRES
     * =================================================================
     */

    static detectFinders(
        data,
        width,
        height,
        centerX,
        centerY,
        radius
    ) {

        const expected = [

            {
                angle:
                    0
            },

            {
                angle:
                    Math.PI / 2
            },

            {
                angle:
                    Math.PI
            },

            {
                angle:
                    3 *
                    Math.PI /
                    2
            }

        ];


        const detections = [];


        for (
            const finder
            of expected
        ) {

            const expectedX =
                centerX +
                radius *
                Math.cos(
                    finder.angle
                );


            const expectedY =
                centerY +
                radius *
                Math.sin(
                    finder.angle
                );


            const searchRadius =
                Math.max(
                    12,
                    radius * 0.08
                );


            const score =
                this.findBlueDensityAround(
                    data,
                    width,
                    height,
                    expectedX,
                    expectedY,
                    searchRadius
                );


            detections.push({

                angle:
                    finder.angle,

                x:
                    expectedX,

                y:
                    expectedY,

                score
            });
        }


        const validFinders =
            detections.filter(
                x =>
                    x.score >= 0.08
            );


        if (
            validFinders.length < 3
        ) {

            return {

                valid:
                    false,

                finders:
                    detections,

                centerX,

                centerY,

                radius
            };
        }


        return {

            valid:
                true,

            count:
                validFinders.length,

            finders:
                detections,

            centerX,

            centerY,

            radius
        };
    }


    /**
     * =================================================================
     * DENSITÉ BLEUE
     * =================================================================
     */

    static findBlueDensityAround(
        data,
        width,
        height,
        cx,
        cy,
        radius
    ) {

        let blue =
            0;


        let total =
            0;


        const minX =
            Math.max(
                0,
                Math.floor(
                    cx -
                    radius
                )
            );


        const maxX =
            Math.min(
                width - 1,
                Math.ceil(
                    cx +
                    radius
                )
            );


        const minY =
            Math.max(
                0,
                Math.floor(
                    cy -
                    radius
                )
            );


        const maxY =
            Math.min(
                height - 1,
                Math.ceil(
                    cy +
                    radius
                )
            );


        for (
            let y = minY;
            y <= maxY;
            y++
        ) {

            for (
                let x = minX;
                x <= maxX;
                x++
            ) {

                const dx =
                    x -
                    cx;


                const dy =
                    y -
                    cy;


                if (
                    dx * dx +
                    dy * dy >
                    radius * radius
                ) {

                    continue;
                }


                const idx =
                    (
                        y *
                        width +
                        x
                    ) * 4;


                const r =
                    data[idx];


                const g =
                    data[idx + 1];


                const b =
                    data[idx + 2];


                const a =
                    data[idx + 3];


                if (
                    a < 40
                ) {

                    continue;
                }


                total++;


                if (
                    this.isSealBlue(
                        r,
                        g,
                        b
                    )
                ) {

                    blue++;
                }
            }
        }


        return total > 0
            ? blue / total
            : 0;
    }


    /**
     * =================================================================
     * MESURE DU MARQUEUR CENTRAL
     * =================================================================
     *
     * CORRECTION PRINCIPALE V6
     *
     * Ancienne logique :
     *
     *   rayon 4.5
     *   rayon 7
     *   rayon 10
     *   rayon 12.5
     *
     * puis mélange :
     *
     *   blueDensity * 0.75
     *   +
     *   geometryDensity * 0.25
     *
     * Cette logique confondait le glyphe avec le bit.
     *
     * Nouvelle logique :
     *
     *   1. Calculer la taille réelle du marqueur à partir du scale.
     *   2. Mesurer uniquement le coeur central.
     *   3. Ignorer complètement la densité géométrique.
     *   4. Décider le bit uniquement avec la présence du bleu.
     *
     * Le renderer utilise :
     *
     *   markerSize = round(8 * scale)
     *
     * donc :
     *
     *   markerRadius ≈ 4 * scale
     *
     * =================================================================
     */

    static measureMarker(
        data,
        width,
        height,
        cx,
        cy,
        scale
    ) {

        /*
         * Sécurité.
         */

        if (
            !Number.isFinite(scale) ||
            scale <= 0
        ) {

            scale = 1;
        }


        /*
         * Taille canonique réelle du marqueur.
         */

        const markerRadius =
            Math.max(
                2,
                this.PROTOCOL.markerRadiusCanonical *
                scale
            );


        /*
         * Coeur de mesure.
         *
         * Nous restons à l'intérieur du carré central
         * afin de minimiser l'influence du glyphe.
         */

        const coreRadius =
            Math.max(
                1.5,
                markerRadius *
                this.PROTOCOL.markerCoreRatio
            );


        /*
         * Une seconde mesure légèrement plus large sert
         * uniquement de confirmation.
         *
         * Elle ne réintroduit PAS la géométrie dans le bit.
         */

        const probeRadius =
            Math.max(
                coreRadius,
                markerRadius *
                this.PROTOCOL.markerProbeRatio
            );


        const core =
            this.sampleBlueCircle(
                data,
                width,
                height,
                cx,
                cy,
                coreRadius
            );


        const probe =
            this.sampleBlueCircle(
                data,
                width,
                height,
                cx,
                cy,
                probeRadius
            );


        if (
            core.totalPixels <
            this.PROTOCOL.minimumMarkerSamples
        ) {

            return {

                bit:
                    0,

                density:
                    0,

                blueDensity:
                    0,

                markerConfidence:
                    0,

                markerRadius,

                coreRadius,

                totalPixels:
                    core.totalPixels
            };
        }


        const coreBlue =
            core.blueDensity;


        const probeBlue =
            probe.blueDensity;


        /*
         * Le coeur est la mesure principale.
         *
         * La mesure probe sert seulement à confirmer
         * qu'un signal bleu existe également autour
         * du coeur.
         */

        const combinedBlue =
            (
                coreBlue * 0.80
            ) +
            (
                probeBlue * 0.20
            );


        /*
         * Décision du bit.
         *
         * IMPORTANT :
         *
         * Aucune mesure de luminance géométrique.
         * Aucun geometryDensity.
         * Aucun filled lié au glyphe.
         */

        let bit;


        if (
            combinedBlue >=
            this.PROTOCOL.markerThreshold
        ) {

            bit = 1;

        } else {

            bit = 0;
        }


        /*
         * Confiance.
         *
         * Plus le signal est loin du seuil,
         * plus la lecture est stable.
         */

        const threshold =
            this.PROTOCOL.markerThreshold;


        const distance =
            Math.abs(
                combinedBlue -
                threshold
            );


        const normalization =
            Math.max(
                0.01,
                1 -
                threshold
            );


        let markerConfidence =
            Math.min(
                1,
                distance /
                normalization
            );


        /*
         * Si le coeur est très bleu,
         * on considère la lecture fortement confirmée.
         */

        if (
            combinedBlue >=
            this.PROTOCOL.markerStrongThreshold
        ) {

            markerConfidence =
                Math.max(
                    markerConfidence,
                    0.85
                );
        }


        /*
         * Si le coeur est pratiquement blanc,
         * la lecture zéro est également forte.
         */

        if (
            bit === 0 &&
            combinedBlue <
            threshold * 0.35
        ) {

            markerConfidence =                Math.max(                    markerConfidence,                    0.80                );        }
        return {

            /*
             * Compatibilité avec l'ancien decoder.
             *
             * density représente maintenant la densité
             * du marqueur, et non plus la densité du glyphe.
             */

            density:                combinedBlue,
            blueDensity:                combinedBlue,
            bit,

            markerConfidence:
                Number(
                    Math.min(
                        1,
                        markerConfidence
                    ).toFixed(3)
                ),


            markerRadius,

            coreRadius,

            totalPixels:
                core.totalPixels,

            coreBlueDensity:
                coreBlue,

            probeBlueDensity:
                probeBlue
        };
    }


    /**
     * =================================================================
     * ÉCHANTILLONNAGE BLEU D'UNE ZONE CIRCULAIRE
     * =================================================================
     */

    static sampleBlueCircle(
        data,
        width,
        height,
        cx,
        cy,
        radius
    ) {

        let blue =
            0;


        let total =
            0;


        const minX =
            Math.max(
                0,
                Math.floor(
                    cx -
                    radius
                )
            );


        const maxX =
            Math.min(
                width - 1,
                Math.ceil(
                    cx +
                    radius
                )
            );


        const minY =
            Math.max(
                0,
                Math.floor(
                    cy -
                    radius
                )
            );


        const maxY =            Math.min(                height - 1,                Math.ceil(                    cy +                    radius                )            );

        for (   let y = minY;            y <= maxY;            y++        ) {
            for (     let x = minX;                x <= maxX;                x++
            ) {

                const dx =                    x -                    cx;
                const dy =                    y -                    cy;

                if (                    (                        dx * dx +                        dy * dy                    ) >
                    radius * radius
                ) {                    continue;                }

                const idx =        (       y *       width +        x                    ) * 4;

                const r =                    data[idx];
                const g =                    data[idx + 1];
                const b =                    data[idx + 2];
                const a =                    data[idx + 3];

                if (                    a < 40                ) {       continue;                }

                total++;

                if (                    this.isSealBlue(                        r,                        g,                        b                    )
                ) {                    blue++;                }           }        }

        return {
            bluePixels:                blue,
            totalPixels:                total,
            blueDensity:                total > 0
                    ? blue / total
                    : 0
        };    }}

/**
 * ====================================================================
 * CALCUL DE CONFIANCE
 * ====================================================================
 *
 * V6 :
 *
 * La confiance porte maintenant sur la stabilité des marqueurs
 * centraux, pas sur la densité des glyphes.
 * ====================================================================
 */

function calculateDecoderConfidence(    matrix,    finderResult,    textResult) {
    if (        !matrix ||        matrix.length !== 51    ) {        return 0;    }

    /*
     * ---------------------------------------------------------------
     * CONFIANCE DES 51 MARQUEURS
     * ---------------------------------------------------------------
     */

    const markerConfidences =
        matrix.map(
            item =>
                Number(
                    item.markerConfidence ??
                    0
                )
        );


    const markerAverage =        markerConfidences.reduce(
            (                sum,                value            ) =>                sum + value,            0        ) /
        markerConfidences.length;

    /*
     * Compter les marqueurs très stables.
     */

    const stableCount =        matrix.filter(            item =>                Number(                    item.markerConfidence ??                    0                ) >= 0.60        ).length;
    const stability =        stableCount /        matrix.length;

    /*
     * ---------------------------------------------------------------
     * CONFIANCE PRINCIPALE
     * ---------------------------------------------------------------
     */

    let confidence =        (            markerAverage *            0.70        ) +
        (            stability *            0.30        );

    /*
     * ---------------------------------------------------------------
     * MIRES
     * ---------------------------------------------------------------
     */

    if (        finderResult &&        finderResult.valid    ) {        confidence +=            0.08;    }

    /*
     * ---------------------------------------------------------------
     * OCR
     * ---------------------------------------------------------------
     *
     * L'OCR ne doit JAMAIS être nécessaire pour authentifier
     * la signature ANOR51.
     *
     * Il augmente seulement légèrement la confiance.
     */

    if (        textResult &&        textResult.confidence >= 70    ) {        confidence +=            0.05;    }

    /*
     * ---------------------------------------------------------------
     * BORNE
     * ---------------------------------------------------------------
     */

    confidence =        Math.min(            0.99,            Math.max(                0.50,                confidence            )        );
    return Number(        confidence.toFixed(3)    );}

/**
 * ====================================================================
 * EXPORTS
 * ====================================================================
 */

if (    typeof module !==    "undefined"
) {    module.exports =
        SealDecoder;}
if (    typeof window !==    "undefined"
) {    window.SealDecoder =
        SealDecoder;}