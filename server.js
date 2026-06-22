const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = 3000;

// Base de datos
const db = new sqlite3.Database('./lavadero.db');

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
// Redirigir raíz al login
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.use(session({
    secret: 'lavadero_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 }
}));

// Crear tablas
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        telefono TEXT,
        rol TEXT NOT NULL,
        password TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS vehiculos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patente TEXT UNIQUE NOT NULL,
        marca TEXT NOT NULL,
        modelo TEXT NOT NULL,
        id_usuario INTEGER NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS servicios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        precio REAL NOT NULL,
        duracion INTEGER NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS turnos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha TEXT NOT NULL,
        hora TEXT NOT NULL,
        estado TEXT DEFAULT 'pendiente',
        id_servicio INTEGER NOT NULL,
        id_vehiculo INTEGER NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS pagos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        monto REAL NOT NULL,
        medio_pago TEXT NOT NULL,
        fecha TEXT NOT NULL,
        id_turno INTEGER NOT NULL
    )`);

    // Insertar datos de ejemplo
    const bcrypt = require('bcrypt');
    const adminPass = bcrypt.hashSync('admin', 10);
    const empleadoPass = bcrypt.hashSync('empleado', 10);
    const cajeroPass = bcrypt.hashSync('cajero', 10);
    const clientePass = bcrypt.hashSync('cliente', 10);

    db.run(`INSERT OR IGNORE INTO usuarios (id, nombre, email, telefono, rol, password) VALUES (1, 'Administrador', 'admin@lavadero.com', '111111111', 'admin', '${adminPass}')`);
    db.run(`INSERT OR IGNORE INTO usuarios (id, nombre, email, telefono, rol, password) VALUES (2, 'Empleado', 'empleado@lavadero.com', '222222222', 'empleado', '${empleadoPass}')`);
    db.run(`INSERT OR IGNORE INTO usuarios (id, nombre, email, telefono, rol, password) VALUES (3, 'Cajero', 'cajero@lavadero.com', '333333333', 'cajero', '${cajeroPass}')`);
    db.run(`INSERT OR IGNORE INTO usuarios (id, nombre, email, telefono, rol, password) VALUES (4, 'Cliente', 'cliente@lavadero.com', '444444444', 'cliente', '${clientePass}')`);
    
    db.run(`INSERT OR IGNORE INTO vehiculos (id, patente, marca, modelo, id_usuario) VALUES (1, 'ABC123', 'Toyota', 'Corolla', 4)`);
    db.run(`INSERT OR IGNORE INTO servicios (id, nombre, precio, duracion) VALUES (1, 'Lavado Simple', 5000, 30)`);
    db.run(`INSERT OR IGNORE INTO servicios (id, nombre, precio, duracion) VALUES (2, 'Lavado Completo', 10000, 60)`);
});

// Ruta de login
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    
    // Verificar que los datos llegaron
    console.log('Login intento:', { email, password });
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email y contraseña son requeridos' });
    }
    
    db.get('SELECT * FROM usuarios WHERE email = ?', [email], (err, user) => {
        if (err) {
            console.error('Error en DB:', err);
            return res.status(500).json({ error: 'Error interno' });
        }
        
        if (!user) {
            console.log('Usuario no encontrado:', email);
            return res.status(401).json({ error: 'Email o contraseña incorrectos' });
        }
        
        // Comparar contraseñas
        bcrypt.compare(password, user.password, (err, match) => {
            if (err) {
                console.error('Error al comparar:', err);
                return res.status(500).json({ error: 'Error interno' });
            }
            
            if (!match) {
                console.log('Contraseña incorrecta para:', email);
                return res.status(401).json({ error: 'Email o contraseña incorrectos' });
            }
            
            req.session.user = {
                id: user.id,
                nombre: user.nombre,
                email: user.email,
                rol: user.rol
            };
            
            console.log('Login exitoso:', user.email, 'Rol:', user.rol);
            res.json({ success: true, rol: user.rol });
        });
    });
});

// Ruta de logout
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Verificar sesion
app.get('/api/session', (req, res) => {
    if (req.session.user) {
        res.json({ user: req.session.user });
    } else {
        res.status(401).json({ error: 'No session' });
    }
});

// Obtener servicios
app.get('/api/servicios', (req, res) => {
    db.all('SELECT * FROM servicios', [], (err, rows) => {
        res.json(rows);
    });
});
// Reporte diario (admin)
app.get('/api/reporte/diario', (req, res) => {
    const { fecha } = req.query;
    if (!req.session.user || req.session.user.rol !== 'admin') {
        return res.status(403).json({ error: 'No autorizado' });
    }
    db.get(`SELECT 
        COALESCE(SUM(p.monto), 0) as total_ingresos,
        COUNT(CASE WHEN t.estado = 'finalizado' THEN 1 END) as servicios_realizados,
        COUNT(CASE WHEN t.estado = 'cancelado' THEN 1 END) as turnos_cancelados
        FROM turnos t LEFT JOIN pagos p ON t.id = p.id_turno WHERE t.fecha = ?`, [fecha], (err, row) => {
        res.json(row);
    });
});

// Historial por patente (admin)
app.get('/api/historial/vehiculo', (req, res) => {
    if (!req.session.user || req.session.user.rol !== 'admin') {
        return res.status(403).json({ error: 'No autorizado' });
    }
    const { patente } = req.query;
    const query = `SELECT t.fecha, t.hora, s.nombre as servicio, s.precio, p.monto as pagado
        FROM turnos t JOIN servicios s ON t.id_servicio = s.id
        JOIN vehiculos v ON t.id_vehiculo = v.id
        LEFT JOIN pagos p ON t.id = p.id_turno
        WHERE v.patente = ? AND t.estado = 'finalizado' ORDER BY t.fecha DESC`;
    db.all(query, [patente], (err, rows) => {
        res.json(rows);
    });
});

// Actualizar servicio (admin)
app.put('/api/servicios/:id', (req, res) => {
    if (!req.session.user || req.session.user.rol !== 'admin') return res.status(403).json({ error: 'No autorizado' });
    const { nombre, precio, duracion } = req.body;
    db.run('UPDATE servicios SET nombre = ?, precio = ?, duracion = ? WHERE id = ?', [nombre, precio, duracion, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Eliminar servicio (admin)
app.delete('/api/servicios/:id', (req, res) => {
    if (!req.session.user || req.session.user.rol !== 'admin') return res.status(403).json({ error: 'No autorizado' });
    db.run('DELETE FROM servicios WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Agregar servicio (admin)
app.post('/api/servicios', (req, res) => {
    if (!req.session.user || req.session.user.rol !== 'admin') return res.status(403).json({ error: 'No autorizado' });
    const { nombre, precio, duracion } = req.body;
    db.run('INSERT INTO servicios (nombre, precio, duracion) VALUES (?, ?, ?)', [nombre, precio, duracion], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
    });
});

// Pagos pendientes (cajero)
app.get('/api/pagos/pendientes', (req, res) => {
    if (!req.session.user || (req.session.user.rol !== 'cajero' && req.session.user.rol !== 'admin')) {
        return res.status(403).json({ error: 'No autorizado' });
    }
    const query = `SELECT t.id as turno_id, t.fecha, t.hora, s.nombre as servicio, s.precio, v.patente, u.nombre as cliente
        FROM turnos t JOIN servicios s ON t.id_servicio = s.id
        JOIN vehiculos v ON t.id_vehiculo = v.id
        JOIN usuarios u ON v.id_usuario = u.id
        LEFT JOIN pagos p ON t.id = p.id_turno
        WHERE t.estado = 'finalizado' AND p.id IS NULL`;
    db.all(query, [], (err, rows) => {
        res.json(rows);
    });
});

// Registrar pago (cajero)
app.post('/api/pagos', (req, res) => {
    if (!req.session.user || (req.session.user.rol !== 'cajero' && req.session.user.rol !== 'admin')) {
        return res.status(403).json({ error: 'No autorizado' });
    }
    const { id_turno, medio_pago, monto } = req.body;
    const fecha = new Date().toISOString().split('T')[0];
    db.run('INSERT INTO pagos (monto, medio_pago, fecha, id_turno) VALUES (?, ?, ?, ?)', [monto, medio_pago, fecha, id_turno], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Turnos de hoy (empleado)
app.get('/api/turnos/hoy', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'No autorizado' });
    const hoy = new Date().toISOString().split('T')[0];
    const query = `SELECT t.*, s.nombre as servicio_nombre, v.patente, v.marca, v.modelo, u.nombre as cliente_nombre
        FROM turnos t JOIN servicios s ON t.id_servicio = s.id
        JOIN vehiculos v ON t.id_vehiculo = v.id
        JOIN usuarios u ON v.id_usuario = u.id
        WHERE t.fecha = ? AND t.estado != 'cancelado' ORDER BY t.hora`;
    db.all(query, [hoy], (err, rows) => {
        res.json(rows);
    });
});

// Cambiar estado del turno (empleado)
app.put('/api/turnos/:id/estado', (req, res) => {
    if (!req.session.user || (req.session.user.rol !== 'empleado' && req.session.user.rol !== 'admin')) {
        return res.status(403).json({ error: 'No autorizado' });
    }
    const { estado } = req.body;
    db.run('UPDATE turnos SET estado = ? WHERE id = ?', [estado, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Cancelar turno (cliente)
app.put('/api/turnos/:id/cancelar', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'No autorizado' });
    db.run('UPDATE turnos SET estado = "cancelado" WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Agregar vehículo (cliente)
app.post('/api/mis-vehiculos', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'No autorizado' });
    const { patente, marca, modelo } = req.body;
    db.run('INSERT INTO vehiculos (patente, marca, modelo, id_usuario) VALUES (?, ?, ?, ?)',
        [patente.toUpperCase(), marca, modelo, req.session.user.id], function(err) {
        if (err) return res.status(500).json({ error: 'La patente ya está registrada' });
        res.json({ id: this.lastID });
    });
});

// Obtener vehículos del cliente
app.get('/api/mis-vehiculos', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'No autorizado' });
    db.all('SELECT * FROM vehiculos WHERE id_usuario = ?', [req.session.user.id], (err, rows) => {
        res.json(rows || []);
    });
});

// Crear turno (cliente)
app.post('/api/turnos', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'No autorizado' });
    const { fecha, hora, id_servicio, id_vehiculo } = req.body;
    db.run('INSERT INTO turnos (fecha, hora, id_servicio, id_vehiculo) VALUES (?, ?, ?, ?)',
        [fecha, hora, id_servicio, id_vehiculo], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
    });
});

// Obtener turnos del cliente
app.get('/api/mis-turnos', (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: 'No autorizado' });
    const query = `SELECT t.*, s.nombre as servicio_nombre, s.precio, v.patente, v.marca, v.modelo
        FROM turnos t JOIN servicios s ON t.id_servicio = s.id
        JOIN vehiculos v ON t.id_vehiculo = v.id
        WHERE v.id_usuario = ? ORDER BY t.fecha DESC, t.hora DESC`;
    db.all(query, [req.session.user.id], (err, rows) => {
        res.json(rows || []);
    });
});

// Horarios disponibles
app.get('/api/turnos/disponibles', (req, res) => {
    const { fecha } = req.query;
    db.all('SELECT hora FROM turnos WHERE fecha = ? AND estado != "cancelado"', [fecha], (err, rows) => {
        const ocupadas = rows.map(r => r.hora);
        res.json({ ocupadas });
    });
});
// Iniciar servidor
app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🚗 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`========================================`);
    console.log(`👑 Admin:    admin@lavadero.com / admin`);
    console.log(`👨‍🔧 Empleado: empleado@lavadero.com / empleado`);
    console.log(`💰 Cajero:   cajero@lavadero.com / cajero`);
    console.log(`🚗 Cliente:  cliente@lavadero.com / cliente`);
    console.log(`========================================\n`);
});