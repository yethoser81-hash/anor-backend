// ==========================================
// ANOR V16.5 • GeometryIndex
// Empreinte géométrique complète
// Compatible :
// - 3 couronnes
// - rotation glyphes
// - scale
// - type de forme
// - taille couronne
// - position angulaire
// - remplissage
// ==========================================

const crypto = require('crypto');


const GeometryIndex = {


    build(glyphes) {


        if (!Array.isArray(glyphes)) {

            throw new Error(
                "GeometryIndex : glyphes invalides"
            );

        }



        //--------------------------------------------------
        // Normalisation déterministe
        //--------------------------------------------------

        const normalizedGlyphes =
            glyphes.map((g, index)=>{


                return {


                    index,


                    forme:
                    g.forme || "unknown",



                    rayon:
                    Number(
                        (g.rayon || 0)
                        .toFixed(3)
                    ),



                    angle:
                    Number(
                        (g.angle || 0)
                        .toFixed(5)
                    ),



                    rotation:
                    Number(
                        (
                            g.rotation ||
                            g.angle ||
                            0
                        )
                        .toFixed(5)
                    ),



                    plein:
                    Boolean(
                        g.plein
                    ),



                    scale:
                    Number(
                        (
                            g.scale ||
                            1
                        )
                        .toFixed(3)
                    ),



                    taille:
                    g.taille ||
                    "standard",



                    couronne:
                    GeometryIndex.detectCouronne(
                        g.rayon
                    )


                };


            });



        //--------------------------------------------------
        // Tri obligatoire pour signature stable
        //--------------------------------------------------

        normalizedGlyphes.sort((a,b)=>{


            if(a.couronne !== b.couronne){

                return b.couronne - a.couronne;

            }


            if(a.rayon !== b.rayon){

                return b.rayon - a.rayon;

            }


            if(a.angle !== b.angle){

                return a.angle - b.angle;

            }


            return a.forme.localeCompare(
                b.forme
            );


        });



        //--------------------------------------------------
        // Signature brute complète
        //--------------------------------------------------

        const rawSignature =

        normalizedGlyphes
        .map(g=>{


            return [

                g.index,

                g.couronne,

                g.forme,

                g.rayon,

                g.angle,

                g.rotation,

                g.scale,

                g.plein ? 1 : 0,

                g.taille


            ].join(":");


        })
        .join("|");



        //--------------------------------------------------
        // SHA256 final
        //--------------------------------------------------

        const sha256 =

        crypto
        .createHash("sha256")
        .update(rawSignature)
        .digest("hex");



        //--------------------------------------------------
        // Empreinte courte lisible
        //--------------------------------------------------

        const fingerprint =

        sha256
        .substring(0,16)
        .toUpperCase();



        //--------------------------------------------------
        // Statistiques géométriques
        //--------------------------------------------------

        const couronnes = {

            externe:0,

            milieu:0,

            interne:0

        };



        normalizedGlyphes.forEach(g=>{


            if(g.couronne===3){

                couronnes.externe++;

            }

            else if(g.couronne===2){

                couronnes.milieu++;

            }

            else if(g.couronne===1){

                couronnes.interne++;

            }


        });



        return {


            total_glyphes:
            normalizedGlyphes.length,



            couronnes,



            sha256,



            fingerprint,



            raw_signature:
            rawSignature.substring(
                0,
                128
            ),



            geometry_version:
            "ANOR-GEO-V16.5"



        };


    },



    //--------------------------------------------------
    // Détection de la couronne
    //--------------------------------------------------

    detectCouronne(rayon){


        if(!rayon){

            return 0;

        }


        if(rayon >= 175){

            return 3;

        }


        if(rayon >= 135){

            return 2;

        }


        if(rayon >= 90){

            return 1;

        }


        return 0;


    }


};



module.exports = GeometryIndex;