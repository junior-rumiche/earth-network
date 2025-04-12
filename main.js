import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { locations, get_random_locations } from './locations.js';

// --- Constantes y Variables Globales ---
const GLOBE_RADIUS = 5;
const CLOUD_ALTITUDE = 0.05; // Altitud relativa de las nubes sobre el radio
const ATMOSPHERE_THICKNESS = 0.1; // Grosor relativo de la atmósfera
const STAR_COUNT = 10000;
const DEFAULT_NODE_COUNT = 150; // Nuevo valor por defecto
const MAX_NODE_COUNT = locations.length; // Máximo basado en la lista (actualmente 194)
const MIN_NODE_COUNT = 3;
const TRAFFIC_ARC_ALTITUDE = 0.5; // Altura máxima del arco sobre la superficie
const TRAFFIC_SPEED = 0.01; // Velocidad de los paquetes

let scene, camera, renderer, controls;
let globe_mesh, cloud_mesh, atmosphere_mesh, star_field;
let active_location_markers = []; // Array para guardar los marcadores de nodos activos
let active_traffic_arcs = []; // Array para guardar los arcos de tráfico activos
let current_visible_nodes = DEFAULT_NODE_COUNT;
let texture_loader;
let is_loading = true;

// Elementos de la UI
const loading_indicator = document.getElementById('loading-indicator');
const node_count_slider = document.getElementById('node-count-slider');
const node_count_number = document.getElementById('node-count-number');
const reset_button = document.getElementById('reset-button');
const controls_panel = document.getElementById('controls'); // Referencia al panel de controles
const settings_toggle_button = document.getElementById('settings-toggle-button'); // NUEVO Botón con icono
const canvas = document.getElementById('globe-canvas');
const container = document.getElementById('container');

// --- Inicialización ---
/**
 * Inicializa la escena 3D, la cámara, el renderizador, las luces, los controles
 * y carga los recursos necesarios para la visualización del globo.
 */
function init() {
    // Escena
    scene = new THREE.Scene();

    // Cámara
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    // Ajustar la posición inicial Z de la cámara según el ancho de la ventana
    const initial_zoom_multiplier = window.innerWidth < 768 ? 3.5 : 2.5; // Más alejado en pantallas < 768px
    camera.position.z = GLOBE_RADIUS * initial_zoom_multiplier;

    // Renderizador
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    // Controles de órbita
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; // Suaviza el movimiento
    controls.dampingFactor = 0.05;
    controls.minDistance = GLOBE_RADIUS * 1.2; // Evita acercarse demasiado
    controls.maxDistance = GLOBE_RADIUS * 5; // Límite de alejamiento

    // Luces
    const ambient_light = new THREE.AmbientLight(0xffffff, 0.5); // Luz ambiental suave
    scene.add(ambient_light);
    const directional_light = new THREE.DirectionalLight(0xffffff, 1); // Luz tipo sol
    directional_light.position.set(5, 3, 5);
    scene.add(directional_light);

    // Gestor de Carga y Cargador de Texturas
    const loading_manager = new THREE.LoadingManager(
        // onLoad: Se llama cuando todos los recursos gestionados se han cargado
        () => {
            console.log("Todos los recursos cargados.");
            create_globe();
            create_clouds();
            create_atmosphere();
            create_starfield();
            reset_simulation(); // Inicia la simulación con nodos por defecto
            is_loading = false;
            if (loading_indicator) loading_indicator.style.display = 'none'; // Ocultar indicador
        },
        // onProgress: (Opcional) Se llama mientras se cargan los recursos
        (url, items_loaded, items_total) => {
            console.log(`Cargando recurso: ${url}. (${items_loaded}/${items_total})`);
            if (loading_indicator) {
                loading_indicator.textContent = `Cargando Recursos... (${items_loaded}/${items_total})`;
            }
        },
        // onError: Se llama si algún recurso falla al cargar
        (url) => {
            console.error(`Error cargando el recurso: ${url}`);
            if (loading_indicator) {
                loading_indicator.textContent = `Error al cargar: ${url}. Intenta refrescar.`;
                loading_indicator.style.color = 'red';
            }
            // Podrías decidir detener la inicialización aquí o usar texturas por defecto
        }
    );
    texture_loader = new THREE.TextureLoader(loading_manager); // Pasar el manager al loader

    // Cargar recursos e iniciar simulación
    load_resources_and_start();

    // Configurar UI
    setup_ui();

    // Manejador de redimensionamiento de ventana
    window.addEventListener('resize', on_window_resize, false);

    // Iniciar bucle de animación
    animate();
}

// --- Carga de Recursos ---
/**
 * Inicia la carga de las texturas necesarias (tierra, especular, nubes)
 * utilizando el TextureLoader gestionado por el LoadingManager.
 * La lógica de creación de objetos 3D se ejecutará cuando todas las texturas estén cargadas.
 */
function load_resources_and_start() {
    const earth_texture_url = 'https://unpkg.com/three-globe@2.27.2/example/img/earth-dark.jpg';
    const specular_texture_url = 'https://unpkg.com/three-globe@2.27.2/example/img/earth-specular.png';
    const cloud_texture_url = 'https://unpkg.com/three-globe@2.27.2/example/img/earth-clouds.png';

    // Iniciar la carga de texturas. El loading_manager se encargará del resto.
    texture_loader.load(earth_texture_url, (texture) => {
        earth_texture = texture;
    });

    texture_loader.load(specular_texture_url, (texture) => {
        specular_texture = texture;
    });

    texture_loader.load(cloud_texture_url, (texture) => {
        cloud_texture = texture;
    });

    // Ya no necesitamos el contador manual ni la función onTextureLoad aquí.
    // La lógica de finalización está ahora en el onLoad del LoadingManager.
}

// Variables globales para texturas (para que estén disponibles en las funciones de creación)
let earth_texture, specular_texture, cloud_texture;

// --- Creación de Elementos 3D ---
/**
 * Crea la malla (Mesh) para el globo terráqueo utilizando las texturas cargadas
 * y la añade a la escena.
 */
function create_globe() {
    const geometry = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
    const material = new THREE.MeshPhongMaterial({
        map: earth_texture,
        specularMap: specular_texture,
        shininess: 5,
        specular: new THREE.Color('grey')
    });
    globe_mesh = new THREE.Mesh(geometry, material);
    scene.add(globe_mesh);
    console.log("Globo creado.");
}
/**
 * Crea la malla (Mesh) para la capa de nubes utilizando la textura de nubes cargada,
 * la hace semitransparente y la añade a la escena.
 */
function create_clouds() {
    const geometry = new THREE.SphereGeometry(GLOBE_RADIUS + CLOUD_ALTITUDE, 64, 64);
    const material = new THREE.MeshPhongMaterial({
        map: cloud_texture,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending, // Mezcla aditiva para nubes brillantes
        depthWrite: false // Evita problemas de ordenación con la transparencia
    });
    cloud_mesh = new THREE.Mesh(geometry, material);
    scene.add(cloud_mesh);
    console.log("Nubes creadas.");
}
/**
 * Crea una malla (Mesh) con un ShaderMaterial personalizado para simular
 * el brillo atmosférico alrededor del globo y la añade a la escena.
 */
function create_atmosphere() {
    const geometry = new THREE.SphereGeometry(GLOBE_RADIUS + ATMOSPHERE_THICKNESS, 64, 64);
    // Usaremos un ShaderMaterial para un efecto de brillo más controlado
    const vertex_shader = `
        varying vec3 vNormal;
        void main() {
            vNormal = normalize( normalMatrix * normal );
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }
    `;
    const fragment_shader = `
        varying vec3 vNormal;
        void main() {
            // Calcula la intensidad basada en el ángulo de la normal con la vista
            float intensity = pow( 0.6 - dot( vNormal, vec3( 0.0, 0.0, 1.0 ) ), 2.0 );
            gl_FragColor = vec4( 0.3, 0.6, 1.0, 1.0 ) * intensity * 0.8; // Color azulado, ajusta alpha con intensidad
        }
    `;
    const material = new THREE.ShaderMaterial({
        vertexShader: vertex_shader,
        fragmentShader: fragment_shader,
        side: THREE.BackSide, // Renderizar la cara interior para ver el brillo desde fuera
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false
    });
    atmosphere_mesh = new THREE.Mesh(geometry, material);
    scene.add(atmosphere_mesh);
    console.log("Atmósfera creada.");
}
/**
 * Crea un sistema de partículas (Points) para simular un campo de estrellas
 * en el fondo de la escena y lo añade.
 */
function create_starfield() {
    const star_geometry = new THREE.BufferGeometry();
    const star_vertices = [];
    for (let i = 0; i < STAR_COUNT; i++) {
        const x = THREE.MathUtils.randFloatSpread(2000);
        const y = THREE.MathUtils.randFloatSpread(2000);
        const z = THREE.MathUtils.randFloatSpread(2000);
        const d = Math.sqrt(x * x + y * y + z * z);
        if (d > 100) {
            star_vertices.push(x, y, z);
        }
    }
    star_geometry.setAttribute('position', new THREE.Float32BufferAttribute(star_vertices, 3));

    const star_material = new THREE.PointsMaterial({
        color: 0xffffff,
        size: 1.5,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.8
    });

    star_field = new THREE.Points(star_geometry, star_material);
    scene.add(star_field);
    console.log("Campo de estrellas creado.");
}

// --- Lógica de Ubicaciones y Tráfico (Pendiente) ---

/**
 * Convierte coordenadas de latitud y longitud geográficas a un Vector3
 * en la superficie de una esfera con un radio dado.
 * @param {number} lat - Latitud en grados.
 * @param {number} lon - Longitud en grados.
 * @param {number} radius - El radio de la esfera.
 * @returns {THREE.Vector3} El vector 3D correspondiente en la superficie de la esfera.
 */
function lat_lon_to_vector3(lat, lon, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);

    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.sin(theta);

    return new THREE.Vector3(x, y, z);
}

/**
 * Crea un marcador visual (un pequeño círculo brillante) en una posición dada
 * sobre la superficie del globo.
 * @param {THREE.Vector3} position - La posición 3D donde crear el marcador.
 * @returns {THREE.Mesh} La malla (Mesh) del marcador creado.
 */
function create_location_marker(position) {
    const geometry = new THREE.CircleGeometry(0.05, 16); // Círculo plano pequeño
    const material = new THREE.MeshBasicMaterial({
        color: 0x00ffaa, // Verde menta brillante
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
    });
    const marker = new THREE.Mesh(geometry, material);
    marker.position.copy(position);
    // Orientar el marcador hacia afuera del globo
    // Orientar el marcador hacia afuera. Como estará dentro de globeMesh (que está en 0,0,0),
    // podemos usar un vector temporal en el origen del mundo.
    marker.lookAt(new THREE.Vector3(0, 0, 0));
    marker.userData.base_scale = marker.scale.clone(); // Guardar escala base para pulso
    return marker;
}

/**
 * Crea una representación visual de un arco de "tráfico" (una curva Bezier con un punto animado)
 * entre dos puntos en la superficie del globo.
 * @param {THREE.Vector3} start_vec - El vector de posición de inicio del arco.
 * @param {THREE.Vector3} end_vec - El vector de posición final del arco.
 */
function create_traffic_arc(start_vec, end_vec) {
    const mid_point = new THREE.Vector3().addVectors(start_vec, end_vec).multiplyScalar(0.5);
    const mid_point_dir = mid_point.clone().normalize();
    mid_point.addScaledVector(mid_point_dir, GLOBE_RADIUS * TRAFFIC_ARC_ALTITUDE);

    const curve = new THREE.QuadraticBezierCurve3(start_vec, mid_point, end_vec);

    const points = curve.getPoints(50);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    const material = new THREE.LineBasicMaterial({
        color: 0x00ffaa,
        linewidth: 1,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
    });

    const arc_line = new THREE.Line(geometry, material);

    // Crear el "paquete" (esfera pequeña)
    const packet_geometry = new THREE.SphereGeometry(0.03, 8, 8);
    const packet_material = new THREE.MeshBasicMaterial({
        color: 0xffffff, // Blanco brillante
        blending: THREE.AdditiveBlending
    });
    const packet = new THREE.Mesh(packet_geometry, packet_material);
    packet.position.copy(start_vec);

    // Guardar datos asociados al arco y paquete
    const arc_data = {
        line: arc_line,
        packet: packet,
        curve: curve,
        progress: 0,
    };

    // Añadir arco y paquete como hijos del globo para que roten con él
    if (globe_mesh) {
        globe_mesh.add(arc_line);
        globe_mesh.add(packet);
    } else {
        console.warn("Intentando añadir arco/paquete antes de que globe_mesh esté listo.");
        scene.add(arc_line);
        scene.add(packet);
    }
    active_traffic_arcs.push(arc_data);
}

/**
 * Actualiza la posición de todos los "paquetes" de tráfico a lo largo de sus arcos.
 * Elimina los arcos y paquetes que han completado su recorrido.
 * Genera nuevo tráfico aleatorio periódicamente.
 */
function update_traffic() {
    const arcs_to_remove = [];
    active_traffic_arcs.forEach((arc_data, index) => {
        arc_data.progress += TRAFFIC_SPEED;
        if (arc_data.progress >= 1) {
            arcs_to_remove.push(index);
            if (globe_mesh) {
                globe_mesh.remove(arc_data.line);
                globe_mesh.remove(arc_data.packet);
            } else {
                scene.remove(arc_data.line);
                scene.remove(arc_data.packet);
            }
            pulse_marker(arc_data.curve.v2);
        } else {
            arc_data.packet.position.copy(arc_data.curve.getPoint(arc_data.progress));
        }
    });

    // Eliminar arcos completados (iterando en reversa para evitar problemas de índice)
    for (let i = arcs_to_remove.length - 1; i >= 0; i--) {
        active_traffic_arcs.splice(arcs_to_remove[i], 1);
    }

    if (!is_loading && active_location_markers.length >= 2 && Math.random() < 0.1) { // Probabilidad de generar nuevo tráfico
        const index1 = Math.floor(Math.random() * active_location_markers.length);
        let index2 = Math.floor(Math.random() * active_location_markers.length);
        while (index1 === index2) {
            index2 = Math.floor(Math.random() * active_location_markers.length);
        }
        const marker1 = active_location_markers[index1];
        const marker2 = active_location_markers[index2];
        create_traffic_arc(marker1.position, marker2.position);
        pulse_marker(marker1.position);
    }
}

/**
 * Aplica un efecto visual de "pulso" (aumento y disminución de escala)
 * a un marcador de ubicación específico.
 * @param {THREE.Vector3} position - La posición del marcador al que aplicar el pulso.
 */
function pulse_marker(position) {
    const target_marker = active_location_markers.find(marker => marker.position.equals(position));
    if (target_marker && !target_marker.userData.is_pulsing) {
        target_marker.userData.is_pulsing = true;
        const base_scale = target_marker.userData.base_scale;
        const pulse_scale = base_scale.clone().multiplyScalar(2.5); // Escala aumentada
        const duration = 300; // ms
        const start_time = performance.now();

        /**
         * Función interna que anima un ciclo del pulso.
         */
        function animate_pulse() {
            const elapsed = performance.now() - start_time;
            const progress = Math.min(elapsed / duration, 1);
            const scale_factor = 1 + 1.5 * Math.sin(progress * Math.PI);
            target_marker.scale.copy(base_scale).multiplyScalar(scale_factor);

            if (progress < 1) {
                requestAnimationFrame(animate_pulse);
            } else {
                target_marker.scale.copy(base_scale);
                target_marker.userData.is_pulsing = false;
            }
        }
        animate_pulse();
    }
}


// --- Gestión de la Simulación ---
/**
 * Reinicia la simulación: limpia los marcadores y arcos existentes,
 * obtiene un nuevo conjunto de ubicaciones aleatorias según el valor actual
 * de `current_visible_nodes`, y crea nuevos marcadores para esas ubicaciones.
 */
function reset_simulation() {
    console.log(`Reiniciando simulación con ${current_visible_nodes} nodos.`);
    if (globe_mesh) {
        active_location_markers.forEach(marker => globe_mesh.remove(marker));
        active_traffic_arcs.forEach(arc_data => {
            globe_mesh.remove(arc_data.line);
            globe_mesh.remove(arc_data.packet);
        });
    } else {
        active_location_markers.forEach(marker => scene.remove(marker));
        active_traffic_arcs.forEach(arc_data => {
            scene.remove(arc_data.line);
            scene.remove(arc_data.packet);
        });
    }
    active_location_markers = [];
    active_traffic_arcs = [];

    const selected_locations = get_random_locations(current_visible_nodes);

    selected_locations.forEach(loc => {
        const position = lat_lon_to_vector3(loc.lat, loc.lon, GLOBE_RADIUS);
        const marker = create_location_marker(position);
        if (globe_mesh) {
            globe_mesh.add(marker);
        } else {
            console.warn("Intentando añadir marcador antes de que globe_mesh esté listo.");
            scene.add(marker);
        }
        active_location_markers.push(marker);
    });
    console.log(`${active_location_markers.length} marcadores creados.`);
}

// --- Configuración de la UI ---
/**
 * Configura los elementos de la interfaz de usuario (slider, campo numérico, botones),
 * establece sus valores iniciales y añade los listeners de eventos necesarios.
 */
function setup_ui() {
    // El panel ahora se oculta inicialmente vía CSS (transform), no necesitamos JS para eso.
    // Sincronizar slider y campo numérico
    // Asegurarse de que DEFAULT_NODE_COUNT no exceda MAX_NODE_COUNT
    const actual_default_node_count = Math.min(DEFAULT_NODE_COUNT, MAX_NODE_COUNT);
    current_visible_nodes = actual_default_node_count;

    node_count_slider.min = MIN_NODE_COUNT;
    node_count_slider.max = MAX_NODE_COUNT;
    node_count_slider.value = actual_default_node_count;
    node_count_number.min = MIN_NODE_COUNT;
    node_count_number.max = MAX_NODE_COUNT;
    node_count_number.value = actual_default_node_count;

    node_count_slider.addEventListener('input', (event) => {
        const count = parseInt(event.target.value, 10);
        node_count_number.value = count;
        current_visible_nodes = count;
    });

    node_count_number.addEventListener('input', (event) => {
        let count = parseInt(event.target.value, 10);

        if (isNaN(count)) count = MIN_NODE_COUNT;
        count = Math.max(MIN_NODE_COUNT, Math.min(MAX_NODE_COUNT, count));
        event.target.value = count;
        node_count_slider.value = count;
        current_visible_nodes = count;
    });

    reset_button.addEventListener('click', () => {
        if (!is_loading) {
            reset_simulation();
        } else {
            console.log("Esperando a que los recursos terminen de cargar...");
        }
    });

    if (settings_toggle_button && controls_panel) {
        settings_toggle_button.addEventListener('click', () => {
            controls_panel.classList.toggle('visible');
        });
    } else {
        console.warn("No se encontró el botón de toggle de configuración o el panel de controles.");
    }
}

/**
 * El bucle principal de animación. Se llama recursivamente con requestAnimationFrame.
 * Actualiza las rotaciones de los objetos, los controles de órbita, el tráfico
 * y renderiza la escena.
 */
function animate() {
    requestAnimationFrame(animate);

    // Rotación lenta del globo y las nubes
    if (globe_mesh) {
        globe_mesh.rotation.y += 0.0005;
    }
    if (cloud_mesh) {
        cloud_mesh.rotation.y += 0.0007; // Nubes rotan un poco más rápido
    }
    if (star_field) {
        star_field.rotation.y += 0.0001; // Estrellas rotan muy lento
    }

    controls.update();

    if (!is_loading) {
        update_traffic();
    }

    renderer.render(scene, camera);
}

/**
 * Manejador de eventos para el redimensionamiento de la ventana.
 * Actualiza la relación de aspecto de la cámara y el tamaño del renderizador.
 */
function on_window_resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Iniciar la aplicación ---
init();