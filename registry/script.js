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
            globalRegistryData = json.items || [];
            afficherRegistre(globalRegistryData);
        }
    } catch (err) {
        console.error("Erreur de chargement du registre", err);
        document.getElementById("registryTableBody").innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--accent-red);">Erreur lors de la récupération des données du registre.</td></tr>`;
    }
}

function afficherRegistre(data) {
    const tbody = document.getElementById("registryTableBody");
    if(!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Aucun enregistrement trouvé.</td></tr>`;
        return;
    }

    // DIAGNOSTIC DIRECT : Affiche le premier objet brut dans la console F12 de ton navigateur
    console.log("STRUCTURE REÇUE DU SERVEUR (Premier élément) :", data[0]);

    tbody.innerHTML = data.map((item, index) => {
        const keys = Object.keys(item);

        // Recherche dynamique et sécurisée basée sur les clés réelles de l'objet
        const numeroLot = item.lot || item.certificate_code || item[keys.find(k => k.toLowerCase().includes('lot') || k.toLowerCase().includes('code'))] || 'N/A';
        const producteur = item.nom_producteur || item[keys.find(k => k.toLowerCase().includes('producteur') || k.toLowerCase().includes('prod') || k.toLowerCase().includes('nom'))] || 'N/A';
        const produit = item.type_emballage || item[keys.find(k => k.toLowerCase().includes('produit') || k.toLowerCase().includes('emballage') || k.toLowerCase().includes('type'))] || 'N/A';
        const quantite = item.quantite || item[keys.find(k => k.toLowerCase().includes('quantite') || k.toLowerCase().includes('qty'))] || 0;
        const dateDemande = item.created_at || item[keys.find(k => k.toLowerCase().includes('date') || k.toLowerCase().includes('created'))] || 'N/A';
        const statut = item.statut || item.status || 'CERTIFIÉ';

        return `
            <tr>
                <td><strong>${numeroLot}</strong></td>
                <td>${producteur}</td>
                <td>${produit}</td>
                <td>${Number(quantite).toLocaleString()}</td>
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

    const keys = Object.keys(item);
    const numeroLot = item.lot || item.certificate_code || item[keys.find(k => k.toLowerCase().includes('lot') || k.toLowerCase().includes('code'))] || 'N/A';
    const producteur = item.nom_producteur || item[keys.find(k => k.toLowerCase().includes('producteur') || k.toLowerCase().includes('prod') || k.toLowerCase().includes('nom'))] || 'N/A';
    const produit = item.type_emballage || item[keys.find(k => k.toLowerCase().includes('produit') || k.toLowerCase().includes('emballage') || k.toLowerCase().includes('type'))] || 'N/A';
    const quantite = item.quantite || item[keys.find(k => k.toLowerCase().includes('quantite') || k.toLowerCase().includes('qty'))] || 0;
    const dateDemande = item.created_at || item[keys.find(k => k.toLowerCase().includes('date') || k.toLowerCase().includes('created'))] || 'N/A';
    const statut = item.statut || item.status || 'CERTIFIÉ';

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
        <p><strong>Produit / Type :</strong> ${produit}</p>
        <p><strong>Quantité :</strong> ${Number(quantite).toLocaleString()} unités</p>
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
        const keys = Object.keys(item);
        const lotVal = String(item.lot || item.certificate_code || '');
        const vendVal = String(item.nom_producteur || '');
        const prodVal = String(item.type_emballage || '');

        const matchText = lotVal.toLowerCase().includes(query) ||
                          vendVal.toLowerCase().includes(query) ||
                          prodVal.toLowerCase().includes(query);
        
        const itemStatut = item.statut || item.status || 'CERTIFIÉ';
        const matchStatus = status === "" || itemStatut === status;
        
        return matchText && matchStatus;
    });

    afficherRegistre(filtered);
}

function exporterRegistre() {
    alert("Génération de l'export sécurisé CSV du registre national en cours...");
}