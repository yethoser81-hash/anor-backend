let globalRegistryData = [];

document.addEventListener("DOMContentLoaded", async () => {
    await verifierServeurEtChargerRegistre();
});

async function verifierServeurEtChargerRegistre() {
    const led = document.getElementById("serverLed");
    const label = document.getElementById("serverLabel");
    
    try {
        const res = await fetch('/health');
        if(res.ok) {
            led.style.backgroundColor = "#10b981";
            label.textContent = "Système en Ligne";
            chargerRegistreDonnees();
        } else {
            throw new Error();
        }
    } catch(e) {
        led.style.backgroundColor = "#ef4444";
        label.textContent = "Serveur Hors Ligne";
        document.getElementById("registryTableBody").innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--accent-red);">Connexion au serveur impossible.</td></tr>`;
    }
}

async function chargerRegistreDonnees() {
    try {
        const response = await fetch('/api/registry/data');
        const json = await response.json();
        if(json.success) {
            globalRegistryData = json.items || json.data || json.registry || [];
            console.log("Données chargées avec succès :", globalRegistryData);
            afficherRegistre(globalRegistryData);
        }
    } catch (err) {
        console.error("Erreur de chargement du registre", err);
        document.getElementById("registryTableBody").innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--accent-red);">Erreur lors de la récupération des données du registre.</td></tr>`;
    }
}

// Fonction utilitaire ultra-robuste pour récupérer une propriété peu importe sa casse ou son nom exact
function getVal(item, possibleKeys) {
    if (!item) return '';
    const itemKeys = Object.keys(item);
    for (const target of possibleKeys) {
        // 1. Correspondance exacte
        if (item[target] !== undefined && item[target] !== null && item[target] !== '') {
            return item[target];
        }
        // 2. Correspondance insensible à la casse
        const found = itemKeys.find(k => k.toLowerCase() === target.toLowerCase());
        if (found && item[found] !== undefined && item[found] !== null && item[found] !== '') {
            return item[found];
        }
    }
    return '';
}

function afficherRegistre(data) {
    const tbody = document.getElementById("registryTableBody");
    if(!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Aucun enregistrement trouvé.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map((item, index) => {
        const numeroLot = getVal(item, ['lot', 'certificate_code', 'numero_lot', 'code']) || 'N/A';
        const producteur = getVal(item, ['nom_producteur', 'producteur', 'nom_vendeur', 'vendeur', 'entreprise']) || 'N/A';
        const produit = getVal(item, ['type_emballage', 'produit', 'composition', 'nom_produit', 'libelle']) || 'N/A';
        
        const rawQty = getVal(item, ['quantite', 'qty', 'quantity', 'qte']);
        const quantite = rawQty !== '' && !isNaN(Number(rawQty)) ? Number(rawQty).toLocaleString() : '0';
        
        const rawDate = getVal(item, ['created_at', 'date_demande', 'date', 'inserted_at']);
        const dateDemande = rawDate ? new Date(rawDate).toLocaleDateString() : 'N/A';
        
        const statut = getVal(item, ['statut', 'status']) || 'CERTIFIÉ';

        return `
            <tr>
                <td><strong>${numeroLot}</strong></td>
                <td>${producteur}</td>
                <td>${produit}</td>
                <td>${quantite}</td>
                <td>${dateDemande}</td>
                <td><span class="badge-cert">${statut}</span></td>
                <td><button class="btn-details" id="btn-details-${index}">Détails</button></td>
            </tr>
        `;
    }).join('');

    data.forEach((item, index) => {
        const btnDetails = document.getElementById(`btn-details-${index}`);
        if(btnDetails) {
            btnDetails.onclick = () => {
                ouvrirModalDetails(item);
            };
        }
    });
}

function ouvrirModalDetails(item) {
    const modal = document.getElementById("lotModal");
    const modalTitle = document.getElementById("modalTitle");
    const modalDetailsText = document.getElementById("modalDetailsText");
    const modalImageContainer = document.getElementById("modalImageContainer") || document.getElementById("modalProductImage")?.parentElement;

    const numeroLot = getVal(item, ['lot', 'certificate_code', 'numero_lot', 'code']) || 'N/A';
    const producteur = getVal(item, ['nom_producteur', 'producteur', 'nom_vendeur', 'vendeur', 'entreprise']) || 'N/A';
    const produit = getVal(item, ['type_emballage', 'produit', 'composition', 'nom_produit', 'libelle']) || 'N/A';
    
    const rawQty = getVal(item, ['quantite', 'qty', 'quantity', 'qte']);
    const quantite = rawQty !== '' && !isNaN(Number(rawQty)) ? Number(rawQty).toLocaleString() : '0';
    
    const rawDate = getVal(item, ['created_at', 'date_demande', 'date', 'inserted_at']);
    const dateDemande = rawDate ? new Date(rawDate).toLocaleString() : 'N/A';
    
    const statut = getVal(item, ['statut', 'status']) || 'CERTIFIÉ';

    modalTitle.textContent = `Détails du Lot : ${numeroLot}`;
    
    if (modalImageContainer) {
        if (item.image_url) {
            modalImageContainer.innerHTML = `
                <img id="modalProductImage" src="${item.image_url}" alt="Visuel du produit" style="max-width: 100%; max-height: 220px; border-radius: 8px; object-fit: contain; background: #0f172a; padding: 8px; border: 1px solid #334155;">
            `;
        } else {
            modalImageContainer.innerHTML = `
                <div id="modalProductImage" style="height: 180px; display: flex; align-items: center; justify-content: center; background: #0f172a; border: 1px dashed #334155; border-radius: 8px; color: var(--text-muted); font-size: 13px; text-align: center; padding: 10px;">
                    Aucun visuel disponible pour ce lot
                </div>
            `;
        }
    }

    modalDetailsText.innerHTML = `
        <p><strong>Producteur :</strong> ${producteur}</p>
        <p><strong>Produit / Emballage :</strong> ${produit}</p>
        <p><strong>Quantité :</strong> ${quantite} unités</p>
        <p><strong>Date d'émission :</strong> ${dateDemande}</p>
        <p><strong>Statut :</strong> <span style="color: #10b981; font-weight: bold;">${statut}</span></p>
    `;

    modal.style.display = "flex";
}

function fermerModal() {
    const modal = document.getElementById("lotModal");
    if(modal) {
        modal.style.display = "none";
    }
}

window.onclick = function(event) {
    const modal = document.getElementById("lotModal");
    if (event.target === modal) {
        fermerModal();
    }
}

function filtrerRegistre() {
    const query = document.getElementById("registrySearch").value.toLowerCase();
    const status = document.getElementById("statusFilter").value;

    const filtered = globalRegistryData.filter(item => {
        const lotVal = String(getVal(item, ['lot', 'certificate_code'])).toLowerCase();
        const prodVal = String(getVal(item, ['nom_producteur', 'producteur'])).toLowerCase();
        const typeVal = String(getVal(item, ['type_emballage', 'produit'])).toLowerCase();

        const matchText = lotVal.includes(query) || prodVal.includes(query) || typeVal.includes(query);
        
        const itemStatut = getVal(item, ['statut', 'status']) || 'CERTIFIÉ';
        const matchStatus = status === "" || itemStatut === status;
        
        return matchText && matchStatus;
    });

    afficherRegistre(filtered);
}

function exporterRegistre() {
    alert("Génération de l'export sécurisé CSV du registre national en cours...");
}