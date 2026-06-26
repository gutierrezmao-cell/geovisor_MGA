// Configuración inicial del mapa
const map = L.map('map', {
    zoomControl: false, // Desactivamos el control por defecto para moverlo
    preferCanvas: true // Dibuja las capas vectoriales sobre Canvas para alto rendimiento
}).setView([15.0, -85.0], 7); // Coordenadas aproximadas de Honduras/La Moskitia

// Añadir controles de zoom en la esquina inferior derecha
L.control.zoom({ position: 'bottomright' }).addTo(map);

// Variables globales para gráficos dinámicos (Chart.js)
let capasGraficosPersonalizados = {}; // { capaId: { chartType, catField, numField, aggType } }
let activeChartLayerId = null;
let currentChartInstance = null;

const habilitadasCapasBase = {};

const baseMapsConfig = {
    'dark': {
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd'
    },
    'light': {
        url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd'
    },
    'google_streets': {
        url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
        attribution: '&copy; Google'
    },
    'google_satellite': {
        url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
        attribution: '&copy; Google'
    },
    'google_hybrid': {
        url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        attribution: '&copy; Google'
    }
};

let activeBaseMap = 'dark';
let baseMapLayer = null;

function cambiarMapaBase(key, save = true) {
    if (!baseMapsConfig[key]) return;
    
    if (baseMapLayer && map.hasLayer(baseMapLayer)) {
        map.removeLayer(baseMapLayer);
    }
    
    const config = baseMapsConfig[key];
    baseMapLayer = L.tileLayer(config.url, {
        attribution: config.attribution,
        subdomains: config.subdomains || '',
        maxZoom: 20
    });
    
    baseMapLayer.addTo(map);
    baseMapLayer.bringToBack();
    
    activeBaseMap = key;
    if (save) {
        guardarConfiguracionEnSesion();
    }
}

let appTitle = 'Geovisor Mesoamérica';
let appAuthor = 'AFOLU Copernicus';

function actualizarIdentidadApp() {
    const titleEl = document.getElementById('app-title');
    const subtitleEl = document.getElementById('app-subtitle');
    const authorEl = document.getElementById('app-author');
    if (titleEl) {
        const spaceIndex = appTitle.indexOf(' ');
        if (spaceIndex > -1) {
            const firstWord = appTitle.substring(0, spaceIndex);
            const rest = appTitle.substring(spaceIndex);
            titleEl.innerHTML = `${firstWord} <span>${rest}</span>`;
        } else {
            titleEl.textContent = appTitle;
        }
    }
    if (subtitleEl) subtitleEl.textContent = appAuthor;
    if (authorEl) authorEl.textContent = 'Cluster Copernicus AFOLU - Programa Grandes Bosques de Mesoamérica';
}

let appConfig = null; // Guardará la configuración cargada desde configuracion_geovisor.json

async function cargarConfiguracionJSON() {
    try {
        const response = await fetch('configuracion_geovisor.json?t=' + Date.now());
        if (response.ok) {
            const rawText = await response.text();
            const cleanText = rawText.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
            appConfig = JSON.parse(cleanText);
            
            if (appConfig.titulo_geovisor) appTitle = appConfig.titulo_geovisor;
            if (appConfig.autor_desarrollador) appAuthor = appConfig.autor_desarrollador;
            if (appConfig.mapa_base_defecto) activeBaseMap = appConfig.mapa_base_defecto;
        }
    } catch (e) {
        console.error('Error al cargar configuracion_geovisor.json:', e);
    }
}

// Funciones para persistencia de la configuración en localStorage
function guardarConfiguracionEnSesion() {
    const config = {
        activeBaseMap,
        habilitadasCapasBase,
        delimitacionMode,
        activeCountry,
        appTitle,
        appAuthor
    };
    try {
        localStorage.setItem('geovisor_config', JSON.stringify(config));
    } catch (e) {
        console.error('Error al guardar la configuración en localStorage:', e);
    }
}

function cargarConfiguracionDeSesion() {
    try {
        const stored = localStorage.getItem('geovisor_config');
        if (stored) {
            const config = JSON.parse(stored);
            if (config.activeBaseMap) activeBaseMap = config.activeBaseMap;
            if (config.habilitadasCapasBase) {
                Object.assign(habilitadasCapasBase, config.habilitadasCapasBase);
            }
            if (config.delimitacionMode) delimitacionMode = config.delimitacionMode;
            if (config.activeCountry) activeCountry = config.activeCountry;
            if (config.appTitle) appTitle = config.appTitle;
            if (config.appAuthor) appAuthor = config.appAuthor;
            return true;
        }
    } catch (e) {
        console.error('Error al cargar la configuración de localStorage:', e);
    }
    return false;
}

// Funciones auxiliares para determinar y renderizar la simbología de las capas
function detectarTipoGeometria(geojson) {
    if (!geojson) return 'polygon';
    
    let type = '';
    if (geojson.type === 'FeatureCollection') {
        if (geojson.features && geojson.features.length > 0) {
            // Buscar el primer elemento que tenga geometría válida
            const feat = geojson.features.find(f => f.geometry && f.geometry.type);
            if (feat) {
                type = feat.geometry.type;
            }
        }
    } else if (geojson.type === 'Feature') {
        if (geojson.geometry) {
            type = geojson.geometry.type;
        }
    } else if (geojson.type) {
        type = geojson.type;
    }

    if (!type) return 'polygon';

    const typeLower = type.toLowerCase();
    if (typeLower.includes('polygon')) {
        return 'polygon';
    } else if (typeLower.includes('linestring') || typeLower.includes('line')) {
        return 'line';
    } else if (typeLower.includes('point')) {
        return 'point';
    }
    
    return 'polygon';
}

function getIndicadorStyleString(capa) {
    const borderActive = capa.stroke !== false;
    const borderColor = capa.color || '#ffffff';
    const fillActive = capa.fill !== false;
    const fillColor = capa.fillColor || capa.color || '#ffffff';
    const borderStyle = (capa.id.startsWith('zona_estudio_') || capa.id.includes('zona_estudio') || capa.id.includes('zonaestudio') || capa.id.includes('limite')) ? 'dashed' : 'solid';
    
    if (capa.geomType === 'line') {
        return `background-color: ${borderActive ? borderColor : 'transparent'}; border: none;`;
    } else if (capa.geomType === 'point') {
        return `background-color: ${fillActive ? fillColor : 'transparent'}; border: 1.5px solid ${borderActive ? borderColor : 'transparent'};`;
    } else { // 'polygon'
        return `background-color: ${fillActive ? fillColor : 'transparent'}; border: 1.5px ${borderStyle} ${borderActive ? borderColor : 'transparent'};`;
    }
}

function actualizarIndicadorPrincipal(indicator, capa) {
    if (!indicator) return;
    
    const borderActive = capa.stroke !== false;
    const borderColor = capa.color || '#ffffff';
    const fillActive = capa.fill !== false;
    const fillColor = capa.fillColor || capa.color || '#ffffff';
    const borderStyle = (capa.id.startsWith('zona_estudio_') || capa.id.includes('zona_estudio') || capa.id.includes('zonaestudio') || capa.id.includes('limite')) ? 'dashed' : 'solid';
    
    if (capa.geomType === 'line') {
        indicator.style.backgroundColor = borderActive ? borderColor : 'transparent';
        indicator.style.border = 'none';
    } else if (capa.geomType === 'point') {
        indicator.style.backgroundColor = fillActive ? fillColor : 'transparent';
        indicator.style.border = `1.5px solid ${borderActive ? borderColor : 'transparent'}`;
    } else { // 'polygon'
        indicator.style.backgroundColor = fillActive ? fillColor : 'transparent';
        indicator.style.border = `1.5px ${borderStyle} ${borderActive ? borderColor : 'transparent'}`;
    }
}

function inicializarPropiedadesTransparencia(capa) {
    if (capa.transparencia === undefined) {
        if (capa.geomType === 'line') {
            const op = capa.opacity !== undefined ? capa.opacity : 1.0;
            capa.transparencia = Math.round((1 - op) * 100);
        } else {
            const op = capa.fillOpacity !== undefined ? capa.fillOpacity : 0.35;
            capa.transparencia = Math.round((1 - op) * 100);
        }
    }
    if (capa.geomType === 'line') {
        capa.opacity = 1 - (capa.transparencia / 100);
    } else {
        capa.fillOpacity = 1 - (capa.transparencia / 100);
    }
}

// Variable global para almacenar estilos personalizados de las capas
const capasEstilosPersonalizados = {};

function guardarEstilosEnPersistencia() {
    const estilos = {};
    capasData.forEach(c => {
        estilos[c.id] = {
            nombre: c.nombre,
            stroke: c.stroke,
            color: c.color,
            fill: c.fill,
            fillColor: c.fillColor,
            transparencia: c.transparencia,
            radius: c.radius !== undefined ? c.radius : 6,
            weight: c.weight !== undefined ? c.weight : 2,
            simbologiaTipo: c.simbologiaTipo || 'unica',
            campoClasificacion: c.campoClasificacion || '',
            mapaColores: c.mapaColores || {},
            paletaColores: c.paletaColores || 'default'
        };
    });
    // Sincronizar estilos guardados con capasEstilosPersonalizados
    Object.keys(capasEstilosPersonalizados).forEach(key => {
        if (!estilos[key]) {
            estilos[key] = capasEstilosPersonalizados[key];
        } else {
            Object.assign(capasEstilosPersonalizados[key], estilos[key]);
        }
    });
    try {
        localStorage.setItem('geovisor_layer_styles', JSON.stringify(estilos));
    } catch (e) {
        console.error('Error al guardar estilos de capas:', e);
    }
}

function cargarEstilosDePersistencia() {
    try {
        const stored = localStorage.getItem('geovisor_layer_styles');
        if (stored) {
            const estilos = JSON.parse(stored);
            Object.assign(capasEstilosPersonalizados, estilos);
            
            // Aplicar a capasData iniciales
            capasData.forEach(c => {
                if (estilos[c.id]) {
                    const est = estilos[c.id];
                    if (est.stroke !== undefined) c.stroke = est.stroke;
                    if (est.color !== undefined) c.color = est.color;
                    if (est.fill !== undefined) c.fill = est.fill;
                    if (est.fillColor !== undefined) c.fillColor = est.fillColor;
                    if (est.radius !== undefined) c.radius = est.radius;
                    if (est.weight !== undefined) c.weight = est.weight;
                    if (est.simbologiaTipo !== undefined) c.simbologiaTipo = est.simbologiaTipo;
                    if (est.campoClasificacion !== undefined) c.campoClasificacion = est.campoClasificacion;
                    if (est.mapaColores !== undefined) c.mapaColores = est.mapaColores;
                    if (est.paletaColores !== undefined) c.paletaColores = est.paletaColores;
                    if (est.transparencia !== undefined) {
                        c.transparencia = est.transparencia;
                        if (c.geomType === 'line') {
                            c.opacity = 1 - (c.transparencia / 100);
                        } else {
                            c.fillOpacity = 1 - (c.transparencia / 100);
                        }
                    }
                }
            });
        }
    } catch (e) {
        console.error('Error al cargar estilos de capas:', e);
    }
}

// Cargar capa base inicial sin guardar en localStorage
cambiarMapaBase('dark', false);

// Configuración de los países disponibles
const paisesConfig = {
    'ALL': { nombre: 'Toda la región', bounds: [[7.0, -94.0], [21.0, -68.0]], capas: [] },
    'BLZ': { nombre: 'Belice', bounds: [[15.9, -89.2], [18.5, -87.8]], capas: [] },
    'CRI': { nombre: 'Costa Rica', bounds: [[8.0, -86.0], [11.2, -82.5]], capas: [] },
    'DOM': { nombre: 'República Dominicana', bounds: [[17.5, -72.0], [20.0, -68.3]], capas: [] },
    'GTM': { nombre: 'Guatemala', bounds: [[13.7, -92.3], [17.9, -88.2]], capas: [] },
    'HND': { nombre: 'Honduras', bounds: [[13.0, -89.4], [16.5, -83.0]], capas: [] },
    'MEX': { nombre: 'México', bounds: [[14.5, -94.0], [18.5, -86.5]], capas: [] },
    'NIC': { nombre: 'Nicaragua', bounds: [[10.7, -87.7], [15.0, -82.5]], capas: [] },
    'PAN': { nombre: 'Panamá', bounds: [[7.2, -83.0], [9.7, -77.2]], capas: [] },
    'SLV': { nombre: 'El Salvador', bounds: [[13.1, -90.2], [14.5, -87.7]], capas: [] }
};

let activeCountry = 'ALL'; // País activo por defecto (Región Completa)
let delimitacionMode = 'none'; // Modo de delimitación geográfica: 'none' o 'pais'

// Definición de las capas que vamos a cargar
const capasData = [];

// Objeto para almacenar las capas de Leaflet activas
const leafletLayers = {};

// Relación de intersección geográfica entre los Grandes Bosques de Mesoamérica (GBM) y los países de SICA
const gbmPaisesIntersection = {};

// Filtrar dinámicamente la capa GBM según el país activo o la zona de estudio sin cortar sus límites
function filtrarGbmPorPais() {}

// Actualizar las rutas de los archivos de capa basados en el país activo
function updateCapasPaths() {}

// Carga e inicializa una capa GeoJSON propia del usuario
function agregarCapaPropiaAlVisor(nombreCapa, geojsonData) {
    // Generar un ID único para la capa
    const idCapa = 'propia_' + nombreCapa.toLowerCase().replace(/[^a-z0-9]/g, '_');
    
    // Si ya existe la capa en capasData, no duplicarla
    if (capasData.some(c => c.id === idCapa)) {
        console.log(`La capa propia ${nombreCapa} ya existe.`);
        return false;
    }

    // Definir configuración de la capa propia con un color aleatorio para distinguirla
    const colores = ['#f43f5e', '#8b5cf6', '#10b981', '#f59e0b', '#06b6d4', '#ec4899', '#3b82f6'];
    const colorAzar = colores[Math.floor(Math.random() * colores.length)];
    const estiloRestaurado = capasEstilosPersonalizados[idCapa] || { color: colorAzar };
    const geomType = detectarTipoGeometria(geojsonData);
    
    const nuevaCapaConf = {
        id: idCapa,
        nombre: estiloRestaurado.nombre || nombreCapa.replace(/\.geojson$|\.json$/i, ''),
        color: estiloRestaurado.color || colorAzar,
        stroke: estiloRestaurado.stroke !== false,
        fill: estiloRestaurado.fill !== false,
        fillColor: estiloRestaurado.fillColor || estiloRestaurado.color || colorAzar,
        fillOpacity: 0.35,
        radius: estiloRestaurado.radius !== undefined ? estiloRestaurado.radius : 6,
        weight: estiloRestaurado.weight !== undefined ? estiloRestaurado.weight : 2,
        isCustom: true, // Bandera indicadora de capa de usuario
        geomType: geomType,
        transparencia: estiloRestaurado.transparencia,
        simbologiaTipo: estiloRestaurado.simbologiaTipo || 'unica',
        campoClasificacion: estiloRestaurado.campoClasificacion || '',
        mapaColores: estiloRestaurado.mapaColores || {},
        paletaColores: estiloRestaurado.paletaColores || 'default',
        _geojsonOriginal: geojsonData // Guardar copia original para clasificación
    };

    inicializarPropiedadesTransparencia(nuevaCapaConf);
    clasificarCapa(nuevaCapaConf);

    // Añadir a capasData para que pueda interactuar con el visor
    capasData.push(nuevaCapaConf);

    // Crear y añadir el interruptor en la barra lateral
    const listContainer = document.getElementById('layer-list');
    const li = document.createElement('li');
    li.className = 'layer-wrapper custom-layer';
    li.id = `item-${idCapa}`;
    li.innerHTML = `
        <div class="layer-item" style="display: flex; flex-direction: column; align-items: stretch; padding: 12px; gap: 8px;">
            <!-- Fila superior: Info y Switch -->
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <div class="layer-info" style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
                    <div class="color-indicator geom-${nuevaCapaConf.geomType || 'polygon'}" style="${getIndicadorStyleString(nuevaCapaConf)}"></div>
                    <span id="label-name-${idCapa}" class="layer-name" style="color: var(--accent-color); font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${nuevaCapaConf.nombre}">${nuevaCapaConf.nombre}</span>
                </div>
                <label class="switch" style="margin-left: 8px; flex-shrink: 0;">
                    <input type="checkbox" id="toggle-${idCapa}">
                    <span class="slider"></span>
                </label>
            </div>
            
            <!-- Fila inferior: Botones de opciones -->
            <div style="display: flex; align-items: center; gap: 8px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 8px;">
                <button id="btn-chart-${idCapa}" class="btn-chart-layer" style="padding: 4px 8px; font-size: 11px; display: flex; align-items: center; gap: 4px;" title="Graficar datos de la capa">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="feather feather-bar-chart-2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                    Gráfico
                </button>
                <button id="btn-style-${idCapa}" class="btn-style" style="padding: 4px 8px; font-size: 11px; display: flex; align-items: center; gap: 4px;" title="Personalizar estilo">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 14.7255 3.09032 17.1962 4.85857 19C5.01445 19.1559 5.09239 19.2338 5.15233 19.3243C5.30909 19.561 5.34005 19.8634 5.23469 20.1264C5.19443 20.2269 5.13289 20.3168 5.0098 20.4967L4.76777 20.849C4.30557 21.523 4.89868 22.4287 5.7061 22.2573L6.90151 22.003C7.03714 21.9741 7.10496 21.9597 7.1724 21.9669C7.34863 21.9856 7.51862 22.0628 7.64795 22.1829C7.69749 22.2289 7.74204 22.2824 7.83115 22.3893C8.95627 23.7395 10.4286 24 12 24Z"></path><circle cx="7.5" cy="10.5" r="1.5" fill="currentColor"></circle><circle cx="11.5" cy="7.5" r="1.5" fill="currentColor"></circle><circle cx="16.5" cy="9.5" r="1.5" fill="currentColor"></circle><circle cx="15.5" cy="14.5" r="1.5" fill="currentColor"></circle></svg>
                    Estilo
                </button>
                <button id="btn-rename-${idCapa}" class="btn-rename-layer" style="padding: 4px 8px; font-size: 11px; display: flex; align-items: center; gap: 4px; background: none; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: var(--text-secondary); cursor: pointer; transition: all 0.2s;" title="Renombrar capa">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    Renombrar
                </button>
                <button id="btn-delete-${idCapa}" class="btn-icon-close" style="padding: 4px 8px; font-size: 11px; display: flex; align-items: center; gap: 4px; margin-left: auto; background: none; border: 1px solid rgba(239, 68, 68, 0.15); border-radius: 4px; color: #ef4444; cursor: pointer; transition: all 0.2s;" title="Eliminar capa propia">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    Borrar
                </button>
            </div>
        </div>
        <div class="layer-style-panel" id="style-panel-${idCapa}">
            ${obtenerHtmlPanelEstilo(nuevaCapaConf, true)}
        </div>
        <div id="legend-container-${idCapa}" class="layer-legend-wrapper"></div>
    `;
    listContainer.appendChild(li);

    // Eventos para colapsar/expandir el panel de estilos
    const btnStyle = li.querySelector(`#btn-style-${idCapa}`);
    const stylePanel = li.querySelector(`#style-panel-${idCapa}`);
    btnStyle.addEventListener('click', () => {
        stylePanel.classList.toggle('active');
        btnStyle.classList.toggle('active');
        li.classList.toggle('style-active');
        if (stylePanel.classList.contains('active')) {
            poblarCamposDeClasificacion(nuevaCapaConf);
        }
    });

    const btnChart = li.querySelector(`#btn-chart-${idCapa}`);
    if (btnChart) {
        btnChart.addEventListener('click', async () => {
            const checkbox = document.getElementById(`toggle-${idCapa}`);
            if (checkbox && !checkbox.checked) {
                checkbox.checked = true;
                await cargarCapa(nuevaCapaConf);
            }
            abrirPanelGraficos(idCapa);
        });
    }

    // Evento de renombrado de capa
    const btnRename = li.querySelector(`#btn-rename-${idCapa}`);
    if (btnRename) {
        btnRename.addEventListener('click', () => {
            const nuevoNombre = prompt("Introduce el nuevo nombre para la capa:", nuevaCapaConf.nombre);
            if (nuevoNombre && nuevoNombre.trim()) {
                nuevaCapaConf.nombre = nuevoNombre.trim();
                const labelName = document.getElementById(`label-name-${idCapa}`);
                if (labelName) {
                    labelName.textContent = nuevaCapaConf.nombre;
                    labelName.title = nuevaCapaConf.nombre;
                }
                
                // Guardar nombre directamente en persistencia
                if (!capasEstilosPersonalizados[idCapa]) {
                    capasEstilosPersonalizados[idCapa] = {};
                }
                capasEstilosPersonalizados[idCapa].nombre = nuevaCapaConf.nombre;
                guardarEstilosEnPersistencia();
            }
        });
    }

    const aplicarEstilosPropia = () => {
        aplicarCambiosDeEstilo(nuevaCapaConf, li);
    };

    conectarEventosEstilo(li, nuevaCapaConf, aplicarEstilosPropia, true);

    const btnSave = li.querySelector(`#btn-save-style-${idCapa}`);
    if (btnSave) {
        btnSave.addEventListener('click', () => {
            capasEstilosPersonalizados[idCapa] = {
                nombre: nuevaCapaConf.nombre, // Soportar guardado de nombre renombrado
                stroke: nuevaCapaConf.stroke,
                color: nuevaCapaConf.color,
                fill: nuevaCapaConf.fill,
                fillColor: nuevaCapaConf.fillColor,
                transparencia: nuevaCapaConf.transparencia,
                radius: nuevaCapaConf.radius !== undefined ? nuevaCapaConf.radius : 6,
                weight: nuevaCapaConf.weight !== undefined ? nuevaCapaConf.weight : 2,
                simbologiaTipo: nuevaCapaConf.simbologiaTipo || 'unica',
                campoClasificacion: nuevaCapaConf.campoClasificacion || '',
                mapaColores: nuevaCapaConf.mapaColores || {},
                paletaColores: nuevaCapaConf.paletaColores || 'default'
            };
            guardarEstilosEnPersistencia();

            const originalHTML = btnSave.innerHTML;
            btnSave.classList.add('saved');
            btnSave.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
                <span class="btn-text">¡Guardado!</span>
            `;
            
            setTimeout(() => {
                btnSave.classList.remove('saved');
                btnSave.innerHTML = originalHTML;
            }, 1500);
        });
    }

    // Crear la capa Leaflet (Estándar o Calor)
    let leafletLayerInst = null;

    if (nuevaCapaConf.simbologiaTipo === 'calor') {
        const points = [];
        if (geojsonData && geojsonData.features) {
            geojsonData.features.forEach(f => {
                if (f.geometry && f.geometry.type === 'Point' && f.geometry.coordinates) {
                    const lat = f.geometry.coordinates[1];
                    const lng = f.geometry.coordinates[0];
                    let weight = 1;
                    if (nuevaCapaConf.campoClasificacion && f.properties && f.properties[nuevaCapaConf.campoClasificacion] !== undefined) {
                        const wVal = Number(f.properties[nuevaCapaConf.campoClasificacion]);
                        if (!isNaN(wVal)) weight = wVal;
                    }
                    points.push([lat, lng, weight]);
                }
            });
        }

        if (heatLayers[idCapa] && map.hasLayer(heatLayers[idCapa])) {
            map.removeLayer(heatLayers[idCapa]);
        }

        heatLayers[idCapa] = L.heatLayer(points, {
            radius: 20,
            blur: 15,
            max: 1.0,
            opacity: 1 - (nuevaCapaConf.transparencia / 100)
        });

        // Capa interactiva oculta para popups
        leafletLayerInst = L.geoJSON(geojsonData, {
            pointToLayer: function (feature, latlng) {
                return L.circleMarker(latlng, { radius: 10 });
            },
            style: () => ({ opacity: 0, fillOpacity: 0, weight: 0, stroke: false, fill: false }),
            onEachFeature: function (feature, layer) {
                if (feature.properties) {
                    let popupContent = `<div style="max-height: 200px; overflow-y: auto;"><b>Propiedades de ${nuevaCapaConf.nombre}</b><br><br>`;
                    for (const [key, value] of Object.entries(feature.properties)) {
                        popupContent += `<strong>${key}:</strong> ${value}<br>`;
                    }
                    popupContent += `</div>`;
                    layer.bindPopup(popupContent);
                }
            }
        });
        leafletLayers[idCapa] = leafletLayerInst;
    } else {
        leafletLayerInst = L.geoJSON(geojsonData, {
            pointToLayer: function (feature, latlng) {
                return L.circleMarker(latlng, {
                    radius: nuevaCapaConf.radius || 6
                });
            },
            style: function (feature) {
                const visible = esFeatureVisibleEnDelimitacion(feature);
                const strokeVisible = visible && (nuevaCapaConf.stroke !== false);
                const fillVisible = visible && (nuevaCapaConf.fill !== false);
                const colorSimb = obtenerColorSimbologia(feature, nuevaCapaConf);
                return {
                    stroke: strokeVisible,
                    color: nuevaCapaConf.geomType === 'line' ? colorSimb : nuevaCapaConf.color,
                    weight: strokeVisible ? nuevaCapaConf.weight : 0,
                    opacity: strokeVisible ? (nuevaCapaConf.geomType === 'line' ? nuevaCapaConf.opacity : 1) : 0,
                    fill: fillVisible,
                    fillColor: colorSimb,
                    fillOpacity: fillVisible ? (nuevaCapaConf.geomType === 'line' ? 0 : nuevaCapaConf.fillOpacity) : 0,
                    radius: nuevaCapaConf.radius || 6
                };
            },
            onEachFeature: function (feature, layer) {
                const visible = esFeatureVisibleEnDelimitacion(feature);
                if (!visible) {
                    layer.options.interactive = false;
                }
                
                // Hover
                layer.on({
                    mouseover: (e) => {
                        const l = e.target;
                        if (l.options.interactive && l.options.opacity !== 0) {
                            l.setStyle({
                                weight: 4,
                                fillOpacity: Math.min(nuevaCapaConf.fillOpacity + 0.3, 0.9)
                            });
                            l.bringToFront();
                        }
                    },
                    mouseout: (e) => {
                        if (e.target.options.interactive && e.target.options.opacity !== 0) {
                            leafletLayerInst.resetStyle(e.target);
                        }
                    }
                });
                // Popup con las propiedades
                if (feature.properties) {
                    let popupContent = `<div style="max-height: 200px; overflow-y: auto;"><b>Propiedades de ${nuevaCapaConf.nombre}</b><br><br>`;
                    for (const [key, value] of Object.entries(feature.properties)) {
                        popupContent += `<strong>${key}:</strong> ${value}<br>`;
                    }
                    popupContent += `</div>`;
                    layer.bindPopup(popupContent);
                }
            }
        });

        leafletLayers[idCapa] = leafletLayerInst;
    }

    // Agregar listener al botón de borrar capa
    const btnDelete = document.getElementById(`btn-delete-${idCapa}`);
    btnDelete.addEventListener('click', () => {
        // 1. Remover del mapa
        if (leafletLayers[idCapa] && map.hasLayer(leafletLayers[idCapa])) {
            map.removeLayer(leafletLayers[idCapa]);
        }
        if (heatLayers[idCapa] && map.hasLayer(heatLayers[idCapa])) {
            map.removeLayer(heatLayers[idCapa]);
        }
        // 2. Borrar de las colecciones de datos
        delete leafletLayers[idCapa];
        delete heatLayers[idCapa];
        const index = capasData.findIndex(c => c.id === idCapa);
        if (index > -1) {
            capasData.splice(index, 1);
        }
        delete capasEstilosPersonalizados[idCapa];
        guardarEstilosEnPersistencia();
        // 3. Remover del DOM
        li.remove();
    });

    // Agregar listener al interruptor
    const checkbox = document.getElementById(`toggle-${idCapa}`);
    checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            if (nuevaCapaConf.simbologiaTipo === 'calor' && heatLayers[idCapa]) {
                heatLayers[idCapa].addTo(map);
            } else if (leafletLayers[idCapa]) {
                leafletLayers[idCapa].addTo(map);
            }
            // Hacer zoom a la capa cuando se activa
            let bounds = null;
            if (leafletLayers[idCapa] && leafletLayers[idCapa].getBounds) {
                bounds = leafletLayers[idCapa].getBounds();
            }
            if (bounds && bounds.isValid()) {
                map.fitBounds(bounds, { padding: [30, 30] });
            }
        } else {
            if (leafletLayers[idCapa] && map.hasLayer(leafletLayers[idCapa])) {
                map.removeLayer(leafletLayers[idCapa]);
            }
            if (heatLayers[idCapa] && map.hasLayer(heatLayers[idCapa])) {
                map.removeLayer(heatLayers[idCapa]);
            }
            // Cerrar el panel de gráficos si esta capa se desactiva
            if (activeChartLayerId === idCapa) {
                const panel = document.getElementById('chart-panel');
                if (panel) panel.style.display = 'none';
                if (btnChart) btnChart.classList.remove('active');
                activeChartLayerId = null;
                localStorage.removeItem('geovisor_active_chart_layer_id');
            }
        }
    });

    // Activar inmediatamente por comodidad
    checkbox.checked = true;
    if (nuevaCapaConf.simbologiaTipo === 'calor' && heatLayers[idCapa]) {
        heatLayers[idCapa].addTo(map);
    } else if (leafletLayers[idCapa]) {
        leafletLayers[idCapa].addTo(map);
    }
    
    let initialBounds = null;
    if (leafletLayers[idCapa] && leafletLayers[idCapa].getBounds) {
        initialBounds = leafletLayers[idCapa].getBounds();
    }
    if (initialBounds && initialBounds.isValid()) {
        map.fitBounds(initialBounds, { padding: [30, 30] });
    }

    // Inicializar campos de clasificación en la UI
    poblarCamposDeClasificacion(nuevaCapaConf);
    actualizarLeyendaCapa(nuevaCapaConf);
    
    return true;
}

// Funciones de intersección de zona de estudio removidas en visor limpio

// Verifica si una feature (elemento geográfico) intersecta con el bounding box de un país
function intersectsCountry(feature, countryCode) {
    if (countryCode === 'ALL') return true;
    const config = paisesConfig[countryCode];
    if (!config || !config.bounds) return true;

    // Obtener bounding box de la feature
    if (!feature._bbox) {
        try {
            feature._bbox = turf.bbox(feature);
        } catch (e) {
            return true;
        }
    }
    const [fMinLng, fMinLat, fMaxLng, fMaxLat] = feature._bbox;

    // Bounds formato: [[minLat, minLng], [maxLat, maxLng]]
    const [[pMinLat, pMinLng], [pMaxLat, pMaxLng]] = config.bounds;

    // Comprobar solapamiento de cajas delimitadoras
    return !(fMaxLng < pMinLng || fMinLng > pMaxLng || fMaxLat < pMinLat || fMinLat > pMaxLat);
}

// Determina si una feature pertenece a un país por atributos comunes o por bounding box
function featurePerteneceAPais(feature, countryCode) {
    if (countryCode === 'ALL') return true;
    const config = paisesConfig[countryCode];
    if (!config) return true;

    // 1. Intentar por atributos comunes de país
    if (feature.properties) {
        const countryNameLower = config.nombre.toLowerCase();
        const codeLower = countryCode.toLowerCase();
        
        const countryKeys = ['pais', 'country', 'iso', 'iso_code', 'iso_a3', 'iso_a2', 'code', 'codigo', 'cod_pais', 'country_code', 'pais_id'];
        for (const key of countryKeys) {
            for (const propKey of Object.keys(feature.properties)) {
                if (propKey.toLowerCase().includes(key)) {
                    const val = String(feature.properties[propKey]).toLowerCase().trim();
                    if (val === codeLower || val === countryNameLower || val.includes(countryNameLower) || countryNameLower.includes(val)) {
                        return true;
                    }
                }
            }
        }
    }

    // 2. Fallback a intersección por bounding box
    return intersectsCountry(feature, countryCode);
}

// Determina si una feature de capa propia es visible según la delimitación activa (todas visibles por defecto en visor limpio)
function esFeatureVisibleEnDelimitacion(feature) {
    return true;
}

// Filtra y actualiza la visibilidad de todas las capas propias cargadas
function filtrarCapasPersonalizadas() {
    capasData.forEach(c => {
        if (c.id.startsWith('propia_') && leafletLayers[c.id]) {
            leafletLayers[c.id].eachLayer(layer => {
                const visible = esFeatureVisibleEnDelimitacion(layer.feature);
                const strokeVisible = visible && (c.stroke !== false);
                const fillVisible = visible && (c.fill !== false);
                
                const colorSimb = obtenerColorSimbologia(layer.feature, c);
                layer.setStyle({
                    stroke: strokeVisible,
                    color: c.geomType === 'line' ? colorSimb : c.color,
                    weight: strokeVisible ? c.weight : 0,
                    opacity: strokeVisible ? (c.geomType === 'line' ? c.opacity : 1) : 0,
                    fill: fillVisible,
                    fillColor: colorSimb,
                    fillOpacity: fillVisible ? (c.geomType === 'line' ? 0 : c.fillOpacity) : 0,
                    radius: c.radius || 6
                });
                
                if (c.geomType === 'point' && layer.setRadius) {
                    layer.setRadius(c.radius || 6);
                }
                
                if (visible) {
                    layer.options.interactive = true;
                } else {
                    layer.options.interactive = false;
                    layer.closePopup();
                }
            });
        }
    });
}

// Obtiene los códigos de países que intersectan el bounding box de la zona de estudio
function obtenerPaisesIntersecanZona(zonaGeo) {
    const listPaises = [];
    try {
        const zonaBbox = turf.bbox(zonaGeo); // [minLng, minLat, maxLng, maxLat]
        const [zMinLng, zMinLat, zMaxLng, zMaxLat] = zonaBbox;
        
        for (const [code, conf] of Object.entries(paisesConfig)) {
            if (code === 'ALL') continue;
            const [[pMinLat, pMinLng], [pMaxLat, pMaxLng]] = conf.bounds;
            const overlap = !(zMaxLng < pMinLng || zMinLng > pMaxLng || zMaxLat < pMinLat || zMinLat > pMaxLat);
            if (overlap) {
                listPaises.push(code);
            }
        }
    } catch (e) {
        console.error("Error calculando bbox o intersección de países:", e);
    }
    return listPaises.length > 0 ? listPaises : ['HND'];
}

// Lógica de zona de estudio removida en visor limpio

// Escanear carpeta de capas mediante el API del servidor local
async function escanearCarpetaPropias() {
    const statusDiv = document.getElementById('custom-layers-status');
    if (statusDiv) {
        statusDiv.textContent = 'Cargando capas del geovisor...';
        statusDiv.style.color = 'var(--accent-color)';
    }
    
    let loadedCount = 0;
    let files = [];
    
    try {
        const response = await fetch('/api/capas');
        if (response.ok) {
            const data = await response.json();
            files = data.files || [];
        } else {
            throw new Error("API de escaneo no disponible.");
        }
    } catch (error) {
        console.log('El escaneo dinámico falló (servidor local inactivo o despliegue estático). Cargando lista estática del archivo JSON...');
        if (appConfig && appConfig.capas_a_cargar) {
            files = appConfig.capas_a_cargar;
        }
    }

    for (const file of files) {
        try {
            const fileResponse = await fetch(`data/${file}`);
            if (fileResponse.ok) {
                const geojson = await fileResponse.json();
                const success = agregarCapaPropiaAlVisor(file, geojson);
                if (success) loadedCount++;
            }
        } catch (err) {
            console.error(`Error cargando capa ${file}:`, err);
        }
    }

    if (statusDiv) {
        if (loadedCount > 0) {
            statusDiv.textContent = `¡Carga exitosa! Cargadas ${loadedCount} capas.`;
            statusDiv.style.color = '#10b981';
        } else {
            statusDiv.textContent = 'No se encontraron capas para cargar.';
            statusDiv.style.color = 'var(--text-secondary)';
        }
    }
}

// Inicializar el lector de archivos local (PC Upload)
function inicializarFilePicker() {}

// Lógica de modal de configuración removida en visor limpio

// Cambiar de país activo
async function cambiarPais(codigoPais, force = false) {
    if (!force && activeCountry === codigoPais && delimitacionMode === 'pais') return;

    activeCountry = codigoPais;
    delimitacionMode = 'pais';
    const config = paisesConfig[activeCountry];

    // 1. Actualizar indicador visual de país activo
    document.getElementById('active-country-name').textContent = config.nombre;

    // 2. Centrar/Hacer zoom al país seleccionado
    if (config.bounds) {
        map.fitBounds(config.bounds, { animate: true, duration: 1.5 });
    }

    // 3. Actualizar rutas de los GeoJSON e intersecación de GBM
    updateCapasPaths();
    filtrarGbmPorPais();

    // 6. Filtrar las capas personalizadas según el nuevo país seleccionado
    filtrarCapasPersonalizadas();

    if (activeChartLayerId) {
        actualizarGraficoCapa();
    }
}

// Aplica la configuración de visibilidad de las capas base en la barra lateral
function aplicarHabilitacionCapasBase() {}

// Inicializa el selector flotante de mapas base en la esquina superior derecha del mapa
function inicializarControlBaseMaps() {
    const btnBasemap = document.getElementById('btn-basemap');
    const menuBasemap = document.getElementById('basemap-menu');
    const opts = document.querySelectorAll('.basemap-opt');
    
    if (!btnBasemap || !menuBasemap) return;
    
    btnBasemap.addEventListener('click', (e) => {
        e.stopPropagation();
        menuBasemap.classList.toggle('active');
    });
    
    document.addEventListener('click', () => {
        menuBasemap.classList.remove('active');
    });
    
    menuBasemap.addEventListener('click', (e) => {
        e.stopPropagation();
    });
    
    opts.forEach(opt => {
        opt.addEventListener('click', () => {
            const val = opt.getAttribute('data-value');
            cambiarMapaBase(val, true);
            
            opts.forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            
            menuBasemap.classList.remove('active');
        });
    });
}

// Objeto para almacenar las capas de Leaflet de calor activas
const heatLayers = {};

function obtenerHtmlPanelEstilo(capa, isDisponible) {
    const hasFill = capa.geomType !== 'line';
    
    let controlGrosorHtml = '';
    if (capa.geomType === 'point') {
        controlGrosorHtml = `
        <div class="style-row">
            <span>Tamaño de punto</span>
            <div class="style-controls" style="gap: 8px;">
                <input type="range" id="size-slider-${capa.id}" min="1" max="30" value="${capa.radius || 6}" class="style-range" ${isDisponible ? '' : 'disabled'}>
                <span id="size-val-${capa.id}" style="font-size: 11px; color: var(--text-secondary); width: 28px; text-align: right;">${capa.radius || 6}px</span>
            </div>
        </div>
        <div class="style-row">
            <span>Grosor de borde</span>
            <div class="style-controls" style="gap: 8px;">
                <input type="range" id="weight-slider-${capa.id}" min="0" max="10" value="${capa.weight !== undefined ? capa.weight : 2}" class="style-range" ${isDisponible ? '' : 'disabled'}>
                <span id="weight-val-${capa.id}" style="font-size: 11px; color: var(--text-secondary); width: 28px; text-align: right;">${capa.weight !== undefined ? capa.weight : 2}px</span>
            </div>
        </div>`;
    } else if (capa.geomType === 'line') {
        controlGrosorHtml = `
        <div class="style-row">
            <span>Grosor de línea</span>
            <div class="style-controls" style="gap: 8px;">
                <input type="range" id="weight-slider-${capa.id}" min="1" max="15" value="${capa.weight !== undefined ? capa.weight : 2}" class="style-range" ${isDisponible ? '' : 'disabled'}>
                <span id="weight-val-${capa.id}" style="font-size: 11px; color: var(--text-secondary); width: 28px; text-align: right;">${capa.weight !== undefined ? capa.weight : 2}px</span>
            </div>
        </div>`;
    } else { // 'polygon'
        controlGrosorHtml = `
        <div class="style-row">
            <span>Grosor de contorno</span>
            <div class="style-controls" style="gap: 8px;">
                <input type="range" id="weight-slider-${capa.id}" min="0" max="10" value="${capa.weight !== undefined ? capa.weight : 2}" class="style-range" ${isDisponible ? '' : 'disabled'}>
                <span id="weight-val-${capa.id}" style="font-size: 11px; color: var(--text-secondary); width: 28px; text-align: right;">${capa.weight !== undefined ? capa.weight : 2}px</span>
            </div>
        </div>`;
    }
    
    return `
        <div class="style-row">
            <span>Borde (Contorno)</span>
            <div class="style-controls">
                <div class="color-indicator-wrapper" style="width: 12px; height: 12px;">
                    <div id="border-indicator-${capa.id}" class="color-indicator" style="background-color: ${capa.color}; border: 1px solid rgba(255,255,255,0.3)"></div>
                    <input type="color" id="border-picker-${capa.id}" value="${capa.color}" ${isDisponible ? '' : 'disabled'}>
                </div>
                <label class="switch">
                    <input type="checkbox" id="toggle-border-${capa.id}" ${capa.stroke !== false ? 'checked' : ''} ${isDisponible ? '' : 'disabled'}>
                    <span class="slider"></span>
                </label>
            </div>
        </div>
        <div class="style-row" style="${hasFill ? '' : 'display: none;'}">
            <span>Fondo (Relleno)</span>
            <div class="style-controls">
                <div class="color-indicator-wrapper" style="width: 12px; height: 12px;">
                    <div id="fill-indicator-${capa.id}" class="color-indicator" style="background-color: ${capa.fillColor || capa.color}; border: 1px solid rgba(255,255,255,0.3)"></div>
                    <input type="color" id="fill-picker-${capa.id}" value="${capa.fillColor || capa.color}" ${isDisponible ? '' : 'disabled'}>
                </div>
                <label class="switch">
                    <input type="checkbox" id="toggle-fill-${capa.id}" ${capa.fill !== false ? 'checked' : ''} ${isDisponible ? '' : 'disabled'}>
                    <span class="slider"></span>
                </label>
            </div>
        </div>
        <div class="style-row">
            <span>Transparencia</span>
            <div class="style-controls" style="gap: 8px;">
                <input type="range" id="transparency-slider-${capa.id}" min="0" max="100" value="${capa.transparencia}" class="style-range" ${isDisponible ? '' : 'disabled'}>
                <span id="transparency-val-${capa.id}" style="font-size: 11px; color: var(--text-secondary); width: 28px; text-align: right;">${capa.transparencia}%</span>
            </div>
        </div>
        ${controlGrosorHtml}
        
        <!-- Sección de Clasificación -->
        <div class="classification-section">
            <span class="classification-title">Clasificación / Simbología</span>
            <div class="classification-controls">
                <div class="classification-row-inputs">
                    <select id="select-symbology-type-${capa.id}" class="classification-select" ${isDisponible ? '' : 'disabled'}>
                        <option value="unica" ${capa.simbologiaTipo === 'unica' ? 'selected' : ''}>Simbología Única</option>
                        <option value="categorica" ${capa.simbologiaTipo === 'categorica' ? 'selected' : ''}>Categórica (Texto)</option>
                        <option value="graduada" ${capa.simbologiaTipo === 'graduada' ? 'selected' : ''}>Graduada (Números)</option>
                        ${capa.geomType === 'point' ? `<option value="calor" ${capa.simbologiaTipo === 'calor' ? 'selected' : ''}>Mapa de Calor</option>` : ''}
                    </select>
                    
                    <select id="select-symbology-field-${capa.id}" class="classification-select" ${isDisponible ? '' : 'disabled'}>
                        <option value="">-- Seleccionar Campo --</option>
                    </select>
                </div>
                
                <div class="classification-row-inputs">
                    <select id="select-symbology-palette-${capa.id}" class="classification-select" ${isDisponible ? '' : 'disabled'}>
                        <option value="default" ${capa.paletaColores === 'default' ? 'selected' : ''}>Paleta: Color Principal</option>
                        <option value="rainbow" ${capa.paletaColores === 'rainbow' ? 'selected' : ''}>Paleta: Arcoíris</option>
                        <option value="spectral" ${capa.paletaColores === 'spectral' ? 'selected' : ''}>Paleta: Espectral</option>
                        <option value="viridis" ${capa.paletaColores === 'viridis' ? 'selected' : ''}>Paleta: Viridis</option>
                        <option value="coolwarm" ${capa.paletaColores === 'coolwarm' ? 'selected' : ''}>Paleta: Azul-Rojo</option>
                    </select>
                </div>
            </div>
        </div>

        <div class="style-actions-row">
            <button id="btn-save-style-${capa.id}" class="btn-save-style" title="Guardar cambios de estilo permanentemente" ${isDisponible ? '' : 'disabled'}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                <span class="btn-text">Guardar</span>
            </button>
        </div>
    `;
}

function poblarCamposDeClasificacion(capa) {
    const selectField = document.getElementById(`select-symbology-field-${capa.id}`);
    if (!selectField) return;

    const layer = leafletLayers[capa.id] || (heatLayers[capa.id] ? capasData.find(c => c.id === capa.id)._geojsonOriginal : null);
    if (!layer && !capa._geojsonOriginal) {
        selectField.innerHTML = '<option value="">-- Cargar capa para ver campos --</option>';
        return;
    }

    let feature = null;
    if (capa._geojsonOriginal && capa._geojsonOriginal.features && capa._geojsonOriginal.features.length > 0) {
        feature = capa._geojsonOriginal.features[0];
    } else if (layer && layer.toGeoJSON) {
        const geojson = layer.toGeoJSON();
        if (geojson.features && geojson.features.length > 0) {
            feature = geojson.features[0];
        }
    }

    if (!feature || !feature.properties) {
        selectField.innerHTML = '<option value="">-- Sin atributos --</option>';
        return;
    }

    const valPrevio = capa.campoClasificacion || selectField.value;
    selectField.innerHTML = '<option value="">-- Seleccionar Campo --</option>';
    
    Object.keys(feature.properties).sort().forEach(key => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = key;
        if (key === valPrevio) {
            option.selected = true;
        }
        selectField.appendChild(option);
    });
}

function clasificarCapa(capa) {
    const tipo = capa.simbologiaTipo || 'unica';
    const campo = capa.campoClasificacion;
    
    capa.mapaColores = {};

    if (tipo === 'unica' || !campo) return;

    const originalGeo = capa._geojsonOriginal;
    if (!originalGeo || !originalGeo.features) return;

    const features = originalGeo.features;
    const valores = features.map(f => f.properties[campo]).filter(v => v !== undefined && v !== null);

    if (valores.length === 0) return;

    if (tipo === 'categorica') {
        const unicos = Array.from(new Set(valores)).sort();
        const numCategorias = unicos.length;

        unicos.forEach((val, idx) => {
            capa.mapaColores[val] = generarColorDePaleta(idx, numCategorias, capa.paletaColores, capa.color);
        });
    } else if (tipo === 'graduada') {
        const nums = valores.map(v => Number(v)).filter(n => !isNaN(n));
        if (nums.length === 0) return;

        const min = Math.min(...nums);
        const max = Math.max(...nums);
        const rango = max - min;
        
        const numIntervalos = 5;
        capa._intervalosGraduados = [];

        for (let i = 0; i < numIntervalos; i++) {
            const limiteInf = min + (rango / numIntervalos) * i;
            const limiteSup = min + (rango / numIntervalos) * (i + 1);
            const color = generarColorDePaleta(i, numIntervalos, capa.paletaColores, capa.color);
            capa._intervalosGraduados.push({
                min: limiteInf,
                max: limiteSup,
                color: color
            });
        }
    }
}

function generarColorDePaleta(index, total, paleta, colorBase) {
    if (total <= 1) return colorBase;
    const t = index / (total - 1);

    if (paleta === 'rainbow') {
        const hue = Math.round(t * 280);
        return `hsl(${hue}, 85%, 55%)`;
    } else if (paleta === 'spectral') {
        const hue = Math.round((1 - t) * 240);
        return `hsl(${hue}, 90%, 50%)`;
    } else if (paleta === 'viridis') {
        const r = Math.round(68 + t * (253 - 68));
        const g = Math.round(1 + t * (231 - 1));
        const b = Math.round(84 + t * (37 - 84));
        return rgbToHex(r, g, b);
    } else if (paleta === 'coolwarm') {
        const r = Math.round(59 + t * (239 - 59));
        const g = Math.round(130 + t * (68 - 130));
        const b = Math.round(246 + t * (68 - 246));
        return rgbToHex(r, g, b);
    } else {
        const baseHsl = hexToHsl(colorBase);
        if (baseHsl) {
            const l = Math.round(25 + t * 50);
            return `hsl(${baseHsl.h}, ${baseHsl.s}%, ${l}%)`;
        }
        return colorBase;
    }
}

function rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function hexToHsl(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) {
        hex = hex.split('').map(char => char + char).join('');
    }
    if (hex.length !== 6) return null;
    
    let r = parseInt(hex.substring(0, 2), 16) / 255;
    let g = parseInt(hex.substring(2, 4), 16) / 255;
    let b = parseInt(hex.substring(4, 6), 16) / 255;

    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }

    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100)
    };
}

function obtenerColorSimbologia(feature, capaConf) {
    const tipo = capaConf.simbologiaTipo || 'unica';
    const campo = capaConf.campoClasificacion;
    
    if (tipo === 'unica' || !campo || !feature || !feature.properties) {
        return capaConf.fillColor || capaConf.color;
    }

    const val = feature.properties[campo];
    if (val === undefined || val === null) {
        return '#7f8c8d';
    }

    if (tipo === 'categorica') {
        return capaConf.mapaColores[val] || capaConf.fillColor || capaConf.color;
    } else if (tipo === 'graduada') {
        const num = Number(val);
        if (isNaN(num)) return '#7f8c8d';

        if (capaConf._intervalosGraduados) {
            const intv = capaConf._intervalosGraduados.find(i => num >= i.min && num <= i.max);
            if (intv) return intv.color;
            if (num < capaConf._intervalosGraduados[0].min) return capaConf._intervalosGraduados[0].color;
            if (num > capaConf._intervalosGraduados[capaConf._intervalosGraduados.length - 1].max) {
                return capaConf._intervalosGraduados[capaConf._intervalosGraduados.length - 1].color;
            }
        }
    }

    return capaConf.fillColor || capaConf.color;
}

function actualizarLeyendaCapa(capa) {
    const legendContainer = document.getElementById(`legend-container-${capa.id}`);
    if (!legendContainer) return;

    const tipo = capa.simbologiaTipo || 'unica';
    const campo = capa.campoClasificacion;
    
    if (tipo === 'unica' || tipo === 'calor' || !campo || !capa.mapaColores) {
        legendContainer.innerHTML = '';
        legendContainer.style.display = 'none';
        return;
    }

    legendContainer.style.display = 'flex';
    legendContainer.className = 'layer-legend';

    let html = '';

    if (tipo === 'categorica') {
        Object.entries(capa.mapaColores).forEach(([val, color]) => {
            html += `
                <div class="legend-item" title="${val}">
                    <div class="legend-color" style="background-color: ${color};"></div>
                    <span class="legend-label">${val}</span>
                </div>
            `;
        });
    } else if (tipo === 'graduada' && capa._intervalosGraduados) {
        capa._intervalosGraduados.forEach(intv => {
            const label = `${intv.min.toFixed(1)} - ${intv.max.toFixed(1)}`;
            html += `
                <div class="legend-item" title="${label}">
                    <div class="legend-color" style="background-color: ${intv.color};"></div>
                    <span class="legend-label">${label}</span>
                </div>
            `;
        });
    }

    legendContainer.innerHTML = html;
}

function conectarEventosEstilo(li, capa, aplicarEstilosCapa, isDisponible) {
    const toggleBorder = li.querySelector(`#toggle-border-${capa.id}`);
    const borderPicker = li.querySelector(`#border-picker-${capa.id}`);
    const borderIndicator = li.querySelector(`#border-indicator-${capa.id}`);

    const toggleFill = li.querySelector(`#toggle-fill-${capa.id}`);
    const fillPicker = li.querySelector(`#fill-picker-${capa.id}`);
    const fillIndicator = li.querySelector(`#fill-indicator-${capa.id}`);

    const transparencySlider = li.querySelector(`#transparency-slider-${capa.id}`);
    const transparencyVal = li.querySelector(`#transparency-val-${capa.id}`);

    const sizeSlider = li.querySelector(`#size-slider-${capa.id}`);
    const sizeVal = li.querySelector(`#size-val-${capa.id}`);

    const weightSlider = li.querySelector(`#weight-slider-${capa.id}`);
    const weightVal = li.querySelector(`#weight-val-${capa.id}`);

    const selectSymType = li.querySelector(`#select-symbology-type-${capa.id}`);
    const selectSymField = li.querySelector(`#select-symbology-field-${capa.id}`);
    const selectSymPalette = li.querySelector(`#select-symbology-palette-${capa.id}`);

    toggleBorder.addEventListener('change', aplicarEstilosCapa);
    borderPicker.addEventListener('input', (e) => {
        borderIndicator.style.backgroundColor = e.target.value;
        aplicarEstilosCapa();
    });

    if (toggleFill) {
        toggleFill.addEventListener('change', aplicarEstilosCapa);
    }
    if (fillPicker) {
        fillPicker.addEventListener('input', (e) => {
            fillIndicator.style.backgroundColor = e.target.value;
            aplicarEstilosCapa();
        });
    }

    transparencySlider.addEventListener('input', (e) => {
        transparencyVal.textContent = `${e.target.value}%`;
        aplicarEstilosCapa();
    });

    if (sizeSlider) {
        sizeSlider.addEventListener('input', (e) => {
            if (sizeVal) sizeVal.textContent = `${e.target.value}px`;
            aplicarEstilosCapa();
        });
    }

    if (weightSlider) {
        weightSlider.addEventListener('input', (e) => {
            if (weightVal) weightVal.textContent = `${e.target.value}px`;
            aplicarEstilosCapa();
        });
    }

    const manejarCambioClasificacion = () => {
        capa.simbologiaTipo = selectSymType.value;
        capa.campoClasificacion = selectSymField.value;
        capa.paletaColores = selectSymPalette.value;
        
        if (capa.simbologiaTipo === 'unica') {
            selectSymField.disabled = true;
            selectSymPalette.disabled = true;
        } else {
            selectSymField.disabled = !isDisponible;
            selectSymPalette.disabled = !isDisponible;
        }

        clasificarCapa(capa);
        aplicarEstilosCapa();
    };

    selectSymType.addEventListener('change', manejarCambioClasificacion);
    selectSymField.addEventListener('change', manejarCambioClasificacion);
    selectSymPalette.addEventListener('change', manejarCambioClasificacion);

    if (capa.simbologiaTipo === 'unica') {
        selectSymField.disabled = true;
        selectSymPalette.disabled = true;
    }
}

function aplicarCambiosDeEstilo(capa, li) {
    const toggleBorder = li.querySelector(`#toggle-border-${capa.id}`);
    const borderPicker = li.querySelector(`#border-picker-${capa.id}`);
    const borderIndicator = li.querySelector(`#border-indicator-${capa.id}`);

    const toggleFill = li.querySelector(`#toggle-fill-${capa.id}`);
    const fillPicker = li.querySelector(`#fill-picker-${capa.id}`);
    const fillIndicator = li.querySelector(`#fill-indicator-${capa.id}`);

    const transparencySlider = li.querySelector(`#transparency-slider-${capa.id}`);
    const sizeSlider = li.querySelector(`#size-slider-${capa.id}`);
    const weightSlider = li.querySelector(`#weight-slider-${capa.id}`);

    if (!toggleBorder || !borderPicker || !transparencySlider) return;

    const borderActive = toggleBorder.checked;
    const borderColor = borderPicker.value;
    const fillActive = toggleFill ? toggleFill.checked : true;
    const fillColor = fillPicker ? fillPicker.value : borderColor;
    const transparency = parseInt(transparencySlider.value);

    capa.stroke = borderActive;
    capa.color = borderColor;
    capa.fill = fillActive;
    capa.fillColor = fillColor;
    capa.transparencia = transparency;

    if (sizeSlider) {
        capa.radius = parseInt(sizeSlider.value);
    }
    if (weightSlider) {
        capa.weight = parseInt(weightSlider.value);
    }

    if (capa.geomType === 'line') {
        capa.opacity = 1 - (transparency / 100);
    } else {
        capa.fillOpacity = 1 - (transparency / 100);
    }

    const mainIndicator = li.querySelector('.layer-item .color-indicator');
    actualizarIndicadorPrincipal(mainIndicator, capa);

    clasificarCapa(capa);
    actualizarLeyendaCapa(capa);

    const checkbox = document.getElementById(`toggle-${capa.id}`);
    const checked = checkbox ? checkbox.checked : true;

    if (capa.simbologiaTipo === 'calor') {
        if (leafletLayers[capa.id] && map.hasLayer(leafletLayers[capa.id])) {
            map.removeLayer(leafletLayers[capa.id]);
        }
        
        const points = [];
        if (capa._geojsonOriginal && capa._geojsonOriginal.features) {
            capa._geojsonOriginal.features.forEach(f => {
                if (f.geometry && f.geometry.type === 'Point' && f.geometry.coordinates) {
                    const lat = f.geometry.coordinates[1];
                    const lng = f.geometry.coordinates[0];
                    let weight = 1;
                    if (capa.campoClasificacion && f.properties && f.properties[capa.campoClasificacion] !== undefined) {
                        const wVal = Number(f.properties[capa.campoClasificacion]);
                        if (!isNaN(wVal)) weight = wVal;
                    }
                    points.push([lat, lng, weight]);
                }
            });
        }

        if (heatLayers[capa.id] && map.hasLayer(heatLayers[capa.id])) {
            map.removeLayer(heatLayers[capa.id]);
        }
        
        heatLayers[capa.id] = L.heatLayer(points, {
            radius: 20,
            blur: 15,
            max: 1.0,
            opacity: 1 - (transparency / 100)
        });
        
        if (checked) {
            heatLayers[capa.id].addTo(map);
        }
    } else {
        if (heatLayers[capa.id] && map.hasLayer(heatLayers[capa.id])) {
            map.removeLayer(heatLayers[capa.id]);
        }

        if (leafletLayers[capa.id]) {
            if (checked && !map.hasLayer(leafletLayers[capa.id])) {
                leafletLayers[capa.id].addTo(map);
            }
            
            leafletLayers[capa.id].setStyle(feature => {
                const colorSimb = obtenerColorSimbologia(feature, capa);
                return {
                    stroke: borderActive,
                    color: capa.geomType === 'line' ? colorSimb : borderColor,
                    opacity: borderActive ? (capa.geomType === 'line' ? capa.opacity : 1) : 0,
                    fill: fillActive,
                    fillColor: colorSimb,
                    fillOpacity: fillActive ? (capa.geomType === 'line' ? 0 : capa.fillOpacity) : 0,
                    weight: borderActive ? capa.weight : 0,
                    radius: capa.radius || 6
                };
            });

            if (capa.geomType === 'point') {
                leafletLayers[capa.id].eachLayer(layer => {
                    if (layer.setRadius) {
                        layer.setRadius(capa.radius || 6);
                    }
                });
            }
        }
    }


}

// Inicializar UI
function initLayers() {
    const listContainer = document.getElementById('layer-list');
    const config = paisesConfig[activeCountry];
    const capasDisponibles = config ? (config.capas || []) : [];

    capasData.forEach(capa => {
        // 0. Inicializar propiedades de transparencia
        inicializarPropiedadesTransparencia(capa);

        // 1. Crear el elemento en el DOM (Panel lateral)
        const li = document.createElement('li');
        li.className = 'layer-wrapper';
        
        const isModificable = false;
        const isDisponible = true;
        
        if (!isDisponible) {
            li.className += ' disabled';
        }
        
        li.innerHTML = `
            <div class="layer-item">
                <div class="layer-info">
                    <div class="color-indicator geom-${capa.geomType || 'polygon'}" style="${getIndicadorStyleString(capa)}"></div>
                    <span class="layer-name">${capa.nombre}</span>
                </div>
                <div class="layer-actions">
                    <button id="btn-chart-${capa.id}" class="btn-chart-layer" title="Graficar datos de la capa" ${isDisponible ? '' : 'disabled'}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-bar-chart-2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                    </button>
                    <button id="btn-style-${capa.id}" class="btn-style" title="Personalizar estilo" ${isDisponible ? '' : 'disabled'}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 14.7255 3.09032 17.1962 4.85857 19C5.01445 19.1559 5.09239 19.2338 5.15233 19.3243C5.30909 19.561 5.34005 19.8634 5.23469 20.1264C5.19443 20.2269 5.13289 20.3168 5.0098 20.4967L4.76777 20.849C4.30557 21.523 4.89868 22.4287 5.7061 22.2573L6.90151 22.003C7.03714 21.9741 7.10496 21.9597 7.1724 21.9669C7.34863 21.9856 7.51862 22.0628 7.64795 22.1829C7.69749 22.2289 7.74204 22.2824 7.83115 22.3893C8.95627 23.7395 10.4286 24 12 24Z"></path><circle cx="7.5" cy="10.5" r="1.5" fill="currentColor"></circle><circle cx="11.5" cy="7.5" r="1.5" fill="currentColor"></circle><circle cx="16.5" cy="9.5" r="1.5" fill="currentColor"></circle><circle cx="15.5" cy="14.5" r="1.5" fill="currentColor"></circle></svg>
                    </button>
                    <label class="switch">
                        <input type="checkbox" id="toggle-${capa.id}" ${isDisponible ? '' : 'disabled'}>
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
            <div class="layer-style-panel" id="style-panel-${capa.id}">
                ${obtenerHtmlPanelEstilo(capa, isDisponible)}
            </div>
            <div id="legend-container-${capa.id}" class="layer-legend-wrapper"></div>
        `;
        listContainer.appendChild(li);

        // Eventos para colapsar/expandir el panel de estilos
        const btnStyle = li.querySelector(`#btn-style-${capa.id}`);
        const stylePanel = li.querySelector(`#style-panel-${capa.id}`);
        btnStyle.addEventListener('click', () => {
            stylePanel.classList.toggle('active');
            btnStyle.classList.toggle('active');
            li.classList.toggle('style-active');
            
            // Poblar campos si el panel se abre
            if (stylePanel.classList.contains('active')) {
                poblarCamposDeClasificacion(capa);
            }
        });

        const btnChart = li.querySelector(`#btn-chart-${capa.id}`);
        if (btnChart) {
            btnChart.addEventListener('click', async () => {
                const checkbox = document.getElementById(`toggle-${capa.id}`);
                if (checkbox && !checkbox.checked) {
                    checkbox.checked = true;
                    // Forzar carga de capa
                    await cargarCapa(capa);
                }
                abrirPanelGraficos(capa.id);
            });
        }

        const aplicarEstilosCapa = () => {
            aplicarCambiosDeEstilo(capa, li);
        };

        // Conectar los eventos de estilo y de clasificación
        conectarEventosEstilo(li, capa, aplicarEstilosCapa, isDisponible);

        const btnSave = li.querySelector(`#btn-save-style-${capa.id}`);
        if (btnSave) {
            btnSave.addEventListener('click', () => {
                capasEstilosPersonalizados[capa.id] = {
                    stroke: capa.stroke,
                    color: capa.color,
                    fill: capa.fill,
                    fillColor: capa.fillColor,
                    transparencia: capa.transparencia,
                    radius: capa.radius !== undefined ? capa.radius : 6,
                    weight: capa.weight !== undefined ? capa.weight : 2,
                    simbologiaTipo: capa.simbologiaTipo || 'unica',
                    campoClasificacion: capa.campoClasificacion || '',
                    mapaColores: capa.mapaColores || {},
                    paletaColores: capa.paletaColores || 'default'
                };
                guardarEstilosEnPersistencia();

                const originalHTML = btnSave.innerHTML;
                btnSave.classList.add('saved');
                btnSave.innerHTML = `
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 2px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    <span class="btn-text">¡Guardado!</span>
                `;
                
                setTimeout(() => {
                    btnSave.classList.remove('saved');
                    btnSave.innerHTML = originalHTML;
                }, 1500);
            });
        }

        // 2. Añadir evento al checkbox
        const checkbox = document.getElementById(`toggle-${capa.id}`);
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                cargarCapa(capa);
            } else {
                removerCapa(capa.id);
                // Cerrar el panel de gráficos si esta capa se desactiva
                if (activeChartLayerId === capa.id) {
                    const panel = document.getElementById('chart-panel');
                    if (panel) panel.style.display = 'none';
                    if (btnChart) btnChart.classList.remove('active');
                    activeChartLayerId = null;
                    localStorage.removeItem('geovisor_active_chart_layer_id');
                }
            }
        });
    });


}

// Función auxiliar para cargar archivos geográficos intentando extensiones .geojson y .json
async function fetchGeoJSONWithFallback(url) {
    try {
        const response = await fetch(url);
        if (response.ok) return response;
    } catch (e) {
        console.warn(`Error al intentar cargar la ruta inicial: ${url}, probando fallback...`, e);
    }
    
    // Si no fue exitoso o falló la red, intentar intercambiar extensión (.geojson <-> .json)
    let altUrl = url;
    if (url.toLowerCase().endsWith('.geojson')) {
        altUrl = url.substring(0, url.length - 8) + '.json';
    } else if (url.toLowerCase().endsWith('.json')) {
        altUrl = url.substring(0, url.length - 5) + '.geojson';
    }
    
    if (altUrl !== url) {
        console.log(`Intentando ruta alternativa: ${altUrl}`);
        const responseAlt = await fetch(altUrl);
        if (responseAlt.ok) return responseAlt;
    }
    
    throw new Error(`HTTP error al cargar la capa en ${url} o ${altUrl}`);
}

// Cargar GeoJSON dinámicamente
async function cargarCapa(capaConf) {
    const checkbox = document.getElementById(`toggle-${capaConf.id}`);
    const deberiaAgregarAlMapa = checkbox ? checkbox.checked : true;

    if (leafletLayers[capaConf.id]) {
        if (deberiaAgregarAlMapa && !map.hasLayer(leafletLayers[capaConf.id])) {
            if (capaConf.simbologiaTipo === 'calor' && heatLayers[capaConf.id]) {
                heatLayers[capaConf.id].addTo(map);
            } else {
                leafletLayers[capaConf.id].addTo(map);
            }
        }
        return;
    }
}

// Remover la capa del mapa
function removerCapa(id) {
    if (leafletLayers[id] && map.hasLayer(leafletLayers[id])) {
        map.removeLayer(leafletLayers[id]);
    }
    if (heatLayers[id] && map.hasLayer(heatLayers[id])) {
        map.removeLayer(heatLayers[id]);
    }
}

// Función auxiliar para llenar el selector
function poblarSelect(selectId, setValores) {
    const select = document.getElementById(selectId);
    // Limpiar opciones anteriores pero conservar la primera (Todos)
    select.innerHTML = '<option value="Todos">Todas las opciones...</option>';
    
    Array.from(setValores).sort().forEach(val => {
        const option = document.createElement('option');
        option.value = val;
        option.textContent = val;
        select.appendChild(option);
    });

    select.disabled = false;
}

// Función para aplicar filtros de visibilidad
async function aplicarFiltro(capaId, atributo, valorAFiltrar) {
    const conf = capasData.find(c => c.id === capaId);
    if (!conf) return;

    const checkbox = document.getElementById(`toggle-${capaId}`);
    
    // Si la capa no está activa o no está cargada en Leaflet, la activamos y cargamos
    if (checkbox && (!checkbox.checked || !leafletLayers[capaId])) {
        checkbox.checked = true;
        await cargarCapa(conf);
    } else if (leafletLayers[capaId] && !map.hasLayer(leafletLayers[capaId])) {
        leafletLayers[capaId].addTo(map);
    }

    if (!leafletLayers[capaId]) return;

    let hayVisibles = false;
    let bounds = L.latLngBounds();

    leafletLayers[capaId].eachLayer(layer => {
        if (valorAFiltrar === "Todos" || layer.feature.properties[atributo] === valorAFiltrar) {
            // Mostrar
            const strokeVisible = conf.stroke !== false;
            const fillVisible = conf.fill !== false;
            layer.setStyle({ 
                stroke: strokeVisible,
                opacity: strokeVisible ? (conf.geomType === 'line' ? (conf.opacity !== undefined ? conf.opacity : 1) : 1) : 0, 
                fill: fillVisible,
                fillOpacity: fillVisible ? (conf.geomType === 'line' ? 0 : (conf.fillOpacity !== undefined ? conf.fillOpacity : 0.35)) : 0, 
                weight: strokeVisible ? conf.weight : 0 
            });
            if (layer.getBounds) {
                bounds.extend(layer.getBounds());
            } else if (layer.getLatLng) {
                bounds.extend(layer.getLatLng());
            }
            hayVisibles = true;
        } else {
            // Ocultar
            layer.setStyle({ opacity: 0, fillOpacity: 0, weight: 0 });
            layer.closePopup();
        }
    });

    // Zoom al polígono filtrado (si no es "Todos")
    if (valorAFiltrar !== "Todos" && hayVisibles) {
        map.fitBounds(bounds, { padding: [50, 50] });
    }

    if (activeChartLayerId === capaId) {
        actualizarGraficoCapa();
    }
}

// Guardar y cargar gráficos en localStorage
function guardarGraficosEnPersistencia() {
    try {
        localStorage.setItem('geovisor_layer_charts', JSON.stringify(capasGraficosPersonalizados));
    } catch (e) {
        console.error('Error al guardar gráficos en persistencia:', e);
    }
}

function cargarGraficosDePersistencia() {
    try {
        const stored = localStorage.getItem('geovisor_layer_charts');
        if (stored) {
            capasGraficosPersonalizados = JSON.parse(stored);
        }
    } catch (e) {
        console.error('Error al cargar gráficos de persistencia:', e);
    }
}

// Abre el panel de gráficos y puebla sus controles
function abrirPanelGraficos(capaId) {
    const capa = capasData.find(c => c.id === capaId);
    if (!capa) return;

    activeChartLayerId = capaId;
    localStorage.setItem('geovisor_active_chart_layer_id', capaId);
    
    // Resaltar el botón activo y apagar los demás
    document.querySelectorAll('.btn-chart-layer').forEach(btn => {
        if (btn.id === `btn-chart-${capaId}`) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    const panel = document.getElementById('chart-panel');
    const layerNameSpan = document.getElementById('chart-layer-name');
    if (panel && layerNameSpan) {
        layerNameSpan.textContent = capa.nombre;
        panel.style.display = 'flex';

        // Restaurar posición guardada si existe
        try {
            const savedPos = localStorage.getItem('geovisor_chart_pos');
            if (savedPos) {
                const pos = JSON.parse(savedPos);
                panel.style.top = pos.top;
                panel.style.left = pos.left;
                panel.style.bottom = 'auto';
                panel.style.right = 'auto';
            } else {
                panel.style.top = 'auto';
                panel.style.left = 'auto';
                panel.style.bottom = '20px';
                panel.style.right = '20px';
            }
        } catch (e) {
            console.error('Error cargando posición de panel de gráficos:', e);
        }
    }

    // Poblar dropdowns de variables
    poblarVariablesGraficos(capa);

    // Si ya existe configuración guardada para esta capa, aplicarla en los dropdowns
    const config = capasGraficosPersonalizados[capaId];
    if (config) {
        document.getElementById('chart-type-select').value = config.chartType || 'bar';
        document.getElementById('chart-cat-select').value = config.catField || '';
        document.getElementById('chart-num-select').value = config.numField || '';
        document.getElementById('chart-agg-select').value = config.aggType || 'sum';
    } else {
        // Resetear a valores por defecto
        document.getElementById('chart-type-select').value = 'bar';
        document.getElementById('chart-cat-select').value = '';
        document.getElementById('chart-num-select').value = '';
        document.getElementById('chart-agg-select').value = 'sum';
    }

    actualizarGraficoCapa();
}

// Puebla las variables categóricas y numéricas del GeoJSON en el panel
function poblarVariablesGraficos(capa) {
    const selectCat = document.getElementById('chart-cat-select');
    const selectNum = document.getElementById('chart-num-select');
    if (!selectCat || !selectNum) return;

    const valCatPrevio = selectCat.value;
    const valNumPrevio = selectNum.value;

    selectCat.innerHTML = '<option value="">-- Seleccionar --</option>';
    selectNum.innerHTML = '<option value="">-- Seleccionar --</option>';

    const originalGeo = capa._geojsonOriginal;
    if (!originalGeo || !originalGeo.features || originalGeo.features.length === 0) {
        return;
    }

    const feature = originalGeo.features[0];
    if (!feature || !feature.properties) return;

    const keys = Object.keys(feature.properties).sort();
    
    // Rellenar variables categóricas (todas)
    keys.forEach(key => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = key;
        if (key === valCatPrevio) opt.selected = true;
        selectCat.appendChild(opt);
    });

    // Rellenar variables numéricas (validadas)
    keys.forEach(key => {
        let isNum = false;
        for (const f of originalGeo.features) {
            const val = f.properties[key];
            if (val !== undefined && val !== null && val !== '') {
                isNum = !isNaN(Number(val));
                break;
            }
        }
        if (isNum) {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = key;
            if (key === valNumPrevio) opt.selected = true;
            selectNum.appendChild(opt);
        }
    });
    
    // Si hay un valor guardado en persistencia, forzar su selección
    const config = capasGraficosPersonalizados[capa.id];
    if (config) {
        if (config.catField) selectCat.value = config.catField;
        if (config.numField) selectNum.value = config.numField;
    }
}

// Agrupa la información y actualiza el gráfico Chart.js
function actualizarGraficoCapa() {
    if (currentChartInstance) {
        currentChartInstance.destroy();
        currentChartInstance = null;
    }

    if (!activeChartLayerId) return;

    const capa = capasData.find(c => c.id === activeChartLayerId);
    if (!capa || !capa._geojsonOriginal || !capa._geojsonOriginal.features) return;

    const chartType = document.getElementById('chart-type-select').value;
    const catField = document.getElementById('chart-cat-select').value;
    const numField = document.getElementById('chart-num-select').value;
    const aggType = document.getElementById('chart-agg-select').value;

    if (!catField || !numField) {
        return;
    }

    let features = [];
    if (leafletLayers[activeChartLayerId]) {
        leafletLayers[activeChartLayerId].eachLayer(subLayer => {
            if (subLayer.feature) {
                // Evitar contar elementos ocultos por filtros locales de estilo
                const isHidden = subLayer.options && subLayer.options.opacity === 0 && subLayer.options.fillOpacity === 0;
                if (!isHidden) {
                    features.push(subLayer.feature);
                }
            }
        });
    } else {
        features = capa._geojsonOriginal.features || [];
    }
    const dataGroups = {};

    features.forEach(f => {
        if (!f.properties) return;
        const catVal = String(f.properties[catField] !== undefined ? f.properties[catField] : 'Sin Datos');
        const numVal = Number(f.properties[numField]);
        
        if (isNaN(numVal)) return;

        if (!dataGroups[catVal]) {
            dataGroups[catVal] = { sum: 0, count: 0 };
        }
        dataGroups[catVal].sum += numVal;
        dataGroups[catVal].count += 1;
    });

    const labels = [];
    const values = [];

    Object.entries(dataGroups).forEach(([cat, group]) => {
        labels.push(cat);
        if (aggType === 'sum') {
            values.push(Number(group.sum.toFixed(2)));
        } else if (aggType === 'avg') {
            values.push(Number((group.sum / group.count).toFixed(2)));
        } else if (aggType === 'count') {
            values.push(group.count);
        }
    });

    const combined = labels.map((l, i) => ({ label: l, value: values[i] }));
    combined.sort((a, b) => b.value - a.value);

    // Límite para visualización estética
    const limit = 25;
    const displayData = combined.slice(0, limit);
    
    const displayLabels = displayData.map(d => d.label);
    const displayValues = displayData.map(d => d.value);

    // Paleta de colores HSL
    const bgColors = [];
    const borderColors = [];
    const count = displayLabels.length;

    for (let i = 0; i < count; i++) {
        const isPie = chartType === 'pie' || chartType === 'doughnut';
        const hue = isPie ? Math.round((i / count) * 360) : 210; // Color homogeneo azul para barras
        const lightness = isPie ? 60 : Math.round(45 + (i / count) * 20); // Degradado para barras
        
        bgColors.push(`hsla(${hue}, 85%, ${lightness}%, 0.65)`);
        borderColors.push(`hsla(${hue}, 85%, ${lightness}%, 0.9)`);
    }

    const canvas = document.getElementById('layer-chart-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: chartType === 'pie' || chartType === 'doughnut',
                position: 'right',
                labels: {
                    color: '#e2e8f0',
                    font: {
                        family: 'Inter, sans-serif',
                        size: 9
                    }
                }
            },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                titleFont: { family: 'Inter', weight: 'bold', size: 11 },
                bodyFont: { family: 'Inter', size: 11 },
                borderColor: 'rgba(255, 255, 255, 0.15)',
                borderWidth: 1
            }
        },
        scales: {
            x: {
                display: chartType !== 'pie' && chartType !== 'doughnut',
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: {
                    color: '#94a3b8',
                    font: { family: 'Inter', size: 9 },
                    maxRotation: 45,
                    minRotation: 0
                }
            },
            y: {
                display: chartType !== 'pie' && chartType !== 'doughnut',
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: {
                    color: '#94a3b8',
                    font: { family: 'Inter', size: 9 }
                }
            }
        }
    };

    currentChartInstance = new Chart(ctx, {
        type: chartType,
        data: {
            labels: displayLabels,
            datasets: [{
                label: `${numField} (${aggType.toUpperCase()})`,
                data: displayValues,
                backgroundColor: bgColors,
                borderColor: borderColors,
                borderWidth: 1.5,
                borderRadius: chartType === 'bar' ? 4 : 0
            }]
        },
        options: options
    });
}

// Hace que el panel de gráficos sea arrastrable (draggable)
function hacerPanelGraficoArrastrable() {
    const panel = document.getElementById('chart-panel');
    if (!panel) return;
    const header = panel.querySelector('.chart-panel-header');
    if (!header) return;

    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    header.style.cursor = 'move';
    header.style.userSelect = 'none';
    header.style.webkitUserSelect = 'none';
    header.style.mozUserSelect = 'none';
    
    header.onmousedown = dragMouseDown;
    header.ontouchstart = dragTouchStart;

    function dragMouseDown(e) {
        e = e || window.event;
        // Evitar arrastrar si se hace clic en botones o iconos
        if (e.target.closest('button') || e.target.closest('svg')) return;
        
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        
        let newTop = panel.offsetTop - pos2;
        let newLeft = panel.offsetLeft - pos1;
        
        // Mantener límites básicos en pantalla
        const minVisible = 40;
        if (newTop < 0) newTop = 0;
        if (newTop > window.innerHeight - minVisible) newTop = window.innerHeight - minVisible;
        if (newLeft < -panel.offsetWidth + minVisible) newLeft = -panel.offsetWidth + minVisible;
        if (newLeft > window.innerWidth - minVisible) newLeft = window.innerWidth - minVisible;

        panel.style.top = newTop + "px";
        panel.style.left = newLeft + "px";
        panel.style.bottom = "auto";
        panel.style.right = "auto";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
        
        localStorage.setItem('geovisor_chart_pos', JSON.stringify({
            top: panel.style.top,
            left: panel.style.left
        }));
    }

    function dragTouchStart(e) {
        if (e.target.closest('button') || e.target.closest('svg')) return;
        
        if (e.touches && e.touches[0]) {
            pos3 = e.touches[0].clientX;
            pos4 = e.touches[0].clientY;
            document.ontouchend = closeTouchDragElement;
            document.ontouchmove = touchElementDrag;
        }
    }

    function touchElementDrag(e) {
        if (e.touches && e.touches[0]) {
            pos1 = pos3 - e.touches[0].clientX;
            pos2 = pos4 - e.touches[0].clientY;
            pos3 = e.touches[0].clientX;
            pos4 = e.touches[0].clientY;
            
            let newTop = panel.offsetTop - pos2;
            let newLeft = panel.offsetLeft - pos1;
            
            const minVisible = 40;
            if (newTop < 0) newTop = 0;
            if (newTop > window.innerHeight - minVisible) newTop = window.innerHeight - minVisible;
            if (newLeft < -panel.offsetWidth + minVisible) newLeft = -panel.offsetWidth + minVisible;
            if (newLeft > window.innerWidth - minVisible) newLeft = window.innerWidth - minVisible;

            panel.style.top = newTop + "px";
            panel.style.left = newLeft + "px";
            panel.style.bottom = "auto";
            panel.style.right = "auto";
        }
    }

    function closeTouchDragElement() {
        document.ontouchend = null;
        document.ontouchmove = null;
        
        localStorage.setItem('geovisor_chart_pos', JSON.stringify({
            top: panel.style.top,
            left: panel.style.left
        }));
    }
}

// Inicializa los listeners de selección de variables y cierre del panel de gráficos
function inicializarControlGraficos() {
    hacerPanelGraficoArrastrable();
    const btnClose = document.getElementById('btn-close-chart-panel');
    const btnSave = document.getElementById('btn-save-chart');
    const selectType = document.getElementById('chart-type-select');
    const selectCat = document.getElementById('chart-cat-select');
    const selectNum = document.getElementById('chart-num-select');
    const selectAgg = document.getElementById('chart-agg-select');

    if (btnClose) {
        btnClose.addEventListener('click', () => {
            const panel = document.getElementById('chart-panel');
            if (panel) panel.style.display = 'none';
            
            document.querySelectorAll('.btn-chart-layer').forEach(btn => {
                btn.classList.remove('active');
            });
            activeChartLayerId = null;
            localStorage.removeItem('geovisor_active_chart_layer_id');
        });
    }

    if (selectType) selectType.addEventListener('change', actualizarGraficoCapa);
    if (selectCat) selectCat.addEventListener('change', actualizarGraficoCapa);
    if (selectNum) selectNum.addEventListener('change', actualizarGraficoCapa);
    if (selectAgg) selectAgg.addEventListener('change', actualizarGraficoCapa);

    if (btnSave) {
        btnSave.addEventListener('click', () => {
            if (!activeChartLayerId) return;

            const chartType = selectType.value;
            const catField = selectCat.value;
            const numField = selectNum.value;
            const aggType = selectAgg.value;

            capasGraficosPersonalizados[activeChartLayerId] = {
                chartType,
                catField,
                numField,
                aggType
            };

            guardarGraficosEnPersistencia();

            const originalHTML = btnSave.innerHTML;
            btnSave.classList.add('saved');
            btnSave.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><polyline points="20 6 9 17 4 12"></polyline></svg>
                ¡Guardado!
            `;

            setTimeout(() => {
                btnSave.classList.remove('saved');
                btnSave.innerHTML = originalHTML;
            }, 1500);
        });
    }
}

// Inicializa el arrastre y redimensionamiento del panel lateral (sidebar)
function inicializarSidebarResizer() {
    const resizer = document.getElementById('sidebar-resizer');
    if (!resizer) return;

    let isDragging = false;

    // Obtener el ancho guardado o usar por defecto 320px
    const savedWidth = localStorage.getItem('geovisor_sidebar_width');
    const startWidth = savedWidth ? parseInt(savedWidth) : 320;

    const startDrag = (clientX) => {
        isDragging = true;
        resizer.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        if (map && map.dragging) {
            map.dragging.disable();
        }
    };

    const doDrag = (clientX) => {
        if (!isDragging) return;
        let newWidth = clientX;
        
        // Límites de ancho
        if (newWidth < 280) newWidth = 280;
        if (newWidth > 600) newWidth = 600;

        document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
    };

    const endDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (map && map.dragging) {
            map.dragging.enable();
        }

        // Guardar el valor en localStorage
        const currentWidth = document.documentElement.style.getPropertyValue('--sidebar-width') || `${startWidth}px`;
        localStorage.setItem('geovisor_sidebar_width', parseInt(currentWidth));
        
        // Actualizar tamaño de Leaflet para reajustar proyecciones internas
        if (map) {
            map.invalidateSize();
        }
    };

    // Eventos de Mouse
    resizer.addEventListener('mousedown', (e) => {
        startDrag(e.clientX);
    });

    document.addEventListener('mousemove', (e) => {
        doDrag(e.clientX);
    });

    document.addEventListener('mouseup', () => {
        endDrag();
    });

    // Eventos de Touch (Dispositivos móviles)
    resizer.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches[0]) {
            startDrag(e.touches[0].clientX);
        }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches[0]) {
            doDrag(e.touches[0].clientX);
        }
    }, { passive: true });

    document.addEventListener('touchend', () => {
        endDrag();
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    // Cargar configuración global desde JSON primero
    await cargarConfiguracionJSON();

    // 0. Cargar estilos de capas guardados en la sesión
    cargarEstilosDePersistencia();

    // Inicializar el redimensionamiento del panel lateral
    inicializarSidebarResizer();

    // 1. Inicializar las capas
    initLayers();
    inicializarControlBaseMaps();
    
    // Enlazar botón de escaneo de la barra lateral
    const btnReEscanear = document.getElementById('btn-re-escanear');
    if (btnReEscanear) {
        btnReEscanear.addEventListener('click', escanearCarpetaPropias);
    }
    
    // 2. Cargar configuración de sesión
    cargarConfiguracionDeSesion();
    actualizarIdentidadApp();
    
    // 3. Aplicar visibilidad de las capas base
    aplicarHabilitacionCapasBase();
    
    // 4. Establecer mapa base guardado y actualizar clases visuales
    cambiarMapaBase(activeBaseMap, false);
    const opts = document.querySelectorAll('.basemap-opt');
    opts.forEach(opt => {
        if (opt.getAttribute('data-value') === activeBaseMap) {
            opt.classList.add('active');
        } else {
            opt.classList.remove('active');
        }
    });

    // 5. Escanear carpetas asíncronamente en segundo plano
    await escanearCarpetaPropias();

    // 6. Restaurar la delimitación guardada (siempre Región Completa en visor limpio)
    delimitacionMode = 'none';
    filtrarCapasPersonalizadas();

    // 7. Inicializar controles y restaurar gráfico guardado
    cargarGraficosDePersistencia();
    inicializarControlGraficos();
    
    const storedActiveChart = localStorage.getItem('geovisor_active_chart_layer_id');
    if (storedActiveChart && capasGraficosPersonalizados[storedActiveChart]) {
        // Esperar un momento a que las capas se carguen para abrir el panel
        setTimeout(() => {
            const checkbox = document.getElementById(`toggle-${storedActiveChart}`);
            if (checkbox && checkbox.checked) {
                abrirPanelGraficos(storedActiveChart);
            }
        }, 1000);
    }
});
