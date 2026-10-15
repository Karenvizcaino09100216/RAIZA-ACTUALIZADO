using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using RAIZA.Data;
using RAIZA.Models;
using RAIZA.Services;

namespace RAIZA.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Microsoft.AspNetCore.Authorization.AllowAnonymous]
    public class AuthController : ControllerBase
    {
        private const int PasswordLongitudMinima = 8;
        private const string MensajeCredencialesInvalidas = "Correo o contraseña incorrectos.";
        private const string MensajeCodigoInvalido = "El código no es válido o ya venció.";
        private const string TipoVerificacion = "Verificacion";
        private const string TipoRecuperacion = "Recuperacion";
        private const int MinutosVigenciaCodigo = 15;
        private const int SegundosEntreEnvios = 60;
        private const int MaxIntentosCodigo = 5;

        private static readonly Regex ReglaPassword = new(@"^(?=.*[A-Za-z])(?=.*\d).{8,}$", RegexOptions.Compiled);
        private const string MensajePassword = "La contraseña debe tener mínimo 8 caracteres, con al menos una letra y un número.";

        private enum ResultadoEnvio { Enviado, Espera, Fallo }

        private static readonly HttpClient HttpGoogle = new() { Timeout = TimeSpan.FromSeconds(10) };

        private readonly IConfiguration _configuration;
        private readonly DatabaseService _context;
        private readonly ILogger<AuthController> _logger;
        private readonly IHostEnvironment _env;
        private readonly ICorreoService _correo;
        private readonly IServiceScopeFactory _scopeFactory;

        public AuthController(IConfiguration configuration, DatabaseService context,
                              ILogger<AuthController> logger, IHostEnvironment env, ICorreoService correo,
                              IServiceScopeFactory scopeFactory)
        {
            _correo = correo;
            _scopeFactory = scopeFactory;
            _configuration = configuration;
            _context = context;
            _logger = logger;
            _env = env;
        }

        // --- DIAGNÓSTICO ---
        [HttpGet("Diagnostico")]
        public async Task<IActionResult> Diagnostico()
        {
            if (!_env.IsDevelopment()) return NotFound();

            string baseDeDatos;
            try
            {
                await _context.Database.OpenConnectionAsync();
                await _context.Database.CloseConnectionAsync();
                baseDeDatos = "OK";
            }
            catch (Exception ex)
            {
                baseDeDatos = ex.GetBaseException().Message;
            }

            return Ok(new
            {
                baseDeDatos,
                jwtKeyConfigurada = !string.IsNullOrWhiteSpace(_configuration["Jwt:Key"]),
                recaptchaSecretConfigurada = !string.IsNullOrWhiteSpace(_configuration["Recaptcha:SecretKey"])
            });
        }

        // --- 1. LOGIN DIRECTO ---
        [HttpPost("Login")]
        public async Task<IActionResult> Login([FromBody] LoginDto login)
        {
            if (login is null || string.IsNullOrWhiteSpace(login.Email) || string.IsNullOrEmpty(login.Password))
            {
                return BadRequest(new { mensaje = "Credenciales incompletas." });
            }

            try
            {
                if (!await ValidarGoogleRecaptcha(login.RecaptchaToken))
                {
                    return BadRequest(new { mensaje = "Verificación de reCAPTCHA fallida. Por favor, inténtalo de nuevo." });
                }

                var correo = NormalizarCorreo(login.Email);
                var usuario = await _context.Usuario.FirstOrDefaultAsync(u => u.Correo == correo);

                if (usuario is null)
                {
                    _logger.LogWarning("Login rechazado: no existe un usuario con el correo {Correo}", correo);
                    return Unauthorized(new { mensaje = MensajeCredencialesInvalidas });
                }

                var esBcrypt = EsHashBcrypt(usuario.ContrasenaHash);
                bool passwordValida;

                if (esBcrypt)
                {
                    passwordValida = VerificarPassword(login.Password, usuario.ContrasenaHash);
                }
                else
                {
                    passwordValida = CompararCodigos(usuario.ContrasenaHash ?? string.Empty, login.Password);

                    if (passwordValida)
                    {
                        try
                        {
                            usuario.ContrasenaHash = BCrypt.Net.BCrypt.HashPassword(login.Password);
                            await _context.SaveChangesAsync();
                            _logger.LogWarning("La cuenta {Correo} se migró de texto plano a BCrypt.", correo);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "No se pudo guardar el hash BCrypt de {Correo}", correo);
                        }
                    }
                }

                if (!passwordValida)
                {
                    return Unauthorized(new { mensaje = MensajeCredencialesInvalidas });
                }

                if (usuario.Estado != "Activo")
                {
                    return Unauthorized(new { mensaje = "Tu cuenta se encuentra inactiva." });
                }

                // Contraseña correcta pero el correo aún no se confirmó: se envía un código nuevo
                if (usuario.VerificacionPendiente)
                {
                    await EmitirCodigoAsync(usuario, TipoVerificacion, respetarEspera: true);
                    return StatusCode(403, new
                    {
                        codigo = "CORREO_NO_VERIFICADO",
                        mensaje = "Debes verificar tu correo para ingresar."
                    });
                }

                return Ok(new
                {
                    Token = GenerarJwt(usuario),
                    Rol = usuario.Rol,
                    Nombre = usuario.Nombre,
                    IdUsuario = usuario.Id
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error inesperado en Login");
                return StatusCode(500, new
                {
                    mensaje = "Error interno en el servidor.",
                    detalle = _env.IsDevelopment() ? ex.GetBaseException().Message : null
                });
            }
        }

        // --- 2. REGISTRO ---
        [HttpPost("Registro")]
        [HttpPost("Register")]
        public async Task<IActionResult> Registrar([FromBody] RegistroDto datos)
        {
            if (datos is null || string.IsNullOrWhiteSpace(datos.Nombre) ||
                string.IsNullOrWhiteSpace(datos.Correo) || string.IsNullOrEmpty(datos.ContrasenaHash))
            {
                return BadRequest(new { mensaje = "Los datos de registro son obligatorios." });
            }

            if (!new System.ComponentModel.DataAnnotations.EmailAddressAttribute().IsValid(datos.Correo))
            {
                return BadRequest(new { mensaje = "El correo electrónico no es válido." });
            }

            if (!ReglaPassword.IsMatch(datos.ContrasenaHash))
            {
                return BadRequest(new { mensaje = MensajePassword });
            }

            try
            {
                var correo = NormalizarCorreo(datos.Correo);

                var existente = await _context.Usuario.FirstOrDefaultAsync(u => u.Correo == correo);
                if (existente is not null)
                {
                    if (!existente.VerificacionPendiente)
                    {
                        return Conflict(new { mensaje = "Ya existe una cuenta registrada con este correo electrónico." });
                    }

                    // Se registró antes pero nunca confirmó el correo: se actualizan sus datos y se reenvía el código
                    existente.Nombre = datos.Nombre.Trim();
                    existente.ContrasenaHash = BCrypt.Net.BCrypt.HashPassword(datos.ContrasenaHash);
                    await _context.SaveChangesAsync();

                    return await ResponderEnvioRegistro(existente);
                }

                var nuevoUsuario = new Usuario
                {
                    Nombre = datos.Nombre.Trim(),
                    Correo = correo,
                    ContrasenaHash = BCrypt.Net.BCrypt.HashPassword(datos.ContrasenaHash),
                    Rol = "Estudiante",
                    Estado = "Activo",
                    VerificacionPendiente = true
                };

                var estrategia = _context.Database.CreateExecutionStrategy();
                await estrategia.ExecuteInTransactionAsync(
                    async () =>
                    {
                        _context.Usuario.Add(nuevoUsuario);
                        await _context.SaveChangesAsync();

                        _context.Estudiante.Add(new Estudiante
                        {
                            idestudiante = nuevoUsuario.Id,
                            Espremium = false,
                            FechaAcceso = DateTime.UtcNow
                        });
                        await _context.SaveChangesAsync();
                    },
                    async () => await _context.Usuario.AnyAsync(u => u.Id == nuevoUsuario.Id));

                return await ResponderEnvioRegistro(nuevoUsuario);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al registrar usuario");
                return StatusCode(500, new { mensaje = "Error al registrar el usuario." });
            }
        }

        // --- 3. VERIFICAR CORREO ---
        [HttpPost("Verificar-Correo")]
        public async Task<IActionResult> VerificarCorreo([FromBody] VerificarCorreoDto datos)
        {
            if (datos is null || string.IsNullOrWhiteSpace(datos.Correo) || string.IsNullOrWhiteSpace(datos.Codigo))
            {
                return BadRequest(new { mensaje = MensajeCodigoInvalido });
            }

            try
            {
                var correo = NormalizarCorreo(datos.Correo);
                var usuario = await _context.Usuario.FirstOrDefaultAsync(u => u.Correo == correo);

                if (usuario is null || !await ValidarCodigoAsync(correo, TipoVerificacion, datos.Codigo.Trim()))
                {
                    return BadRequest(new { mensaje = MensajeCodigoInvalido });
                }

                usuario.VerificacionPendiente = false;
                await _context.SaveChangesAsync();

                return Ok(new { mensaje = "Correo verificado correctamente." });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al verificar el correo");
                return StatusCode(500, new { mensaje = "No pudimos verificar el código. Inténtalo de nuevo." });
            }
        }

        // --- 4. REENVIAR CÓDIGO DE VERIFICACIÓN ---
        // Siempre responde igual para no revelar qué correos están registrados.
        [HttpPost("Reenviar-Codigo")]
        public async Task<IActionResult> ReenviarCodigo([FromBody] ReenviarCodigoDto datos)
        {
            if (datos is not null && !string.IsNullOrWhiteSpace(datos.Correo))
            {
                try
                {
                    var correo = NormalizarCorreo(datos.Correo);
                    var usuario = await _context.Usuario.FirstOrDefaultAsync(u => u.Correo == correo);
                    if (usuario is not null && usuario.VerificacionPendiente)
                    {
                        await EmitirCodigoAsync(usuario, TipoVerificacion, respetarEspera: true);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error al reenviar el código de verificación");
                }
            }
            return Ok(new { mensaje = "Si el correo corresponde a una cuenta pendiente, enviamos un nuevo código." });
        }

        // --- 5. RECUPERAR CONTRASEÑA: pedir código ---
        [HttpPost("Recuperar/Solicitar")]
        public async Task<IActionResult> SolicitarRecuperacion([FromBody] SolicitarRecuperacionDto datos)
        {
            if (datos is not null && !string.IsNullOrWhiteSpace(datos.Email))
            {
                try
                {
                    var correo = NormalizarCorreo(datos.Email);
                    var usuario = await _context.Usuario.FirstOrDefaultAsync(u => u.Correo == correo);
                    if (usuario is not null && usuario.Estado == "Activo")
                    {
                        await EmitirCodigoAsync(usuario, TipoRecuperacion, respetarEspera: true);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error al solicitar la recuperación de contraseña");
                }
            }
            return Ok(new { mensaje = "Si el correo está registrado, enviamos un código." });
        }

        // --- 6. RECUPERAR CONTRASEÑA: código + nueva contraseña ---
        [HttpPost("Recuperar/Restablecer")]
        public async Task<IActionResult> RestablecerPassword([FromBody] RestablecerPasswordDto datos)
        {
            if (datos is null || string.IsNullOrWhiteSpace(datos.Email) ||
                string.IsNullOrWhiteSpace(datos.Codigo) || string.IsNullOrEmpty(datos.NuevaContrasena))
            {
                return BadRequest(new { mensaje = "Los datos son obligatorios." });
            }

            if (!ReglaPassword.IsMatch(datos.NuevaContrasena))
            {
                return BadRequest(new { mensaje = MensajePassword });
            }

            try
            {
                var correo = NormalizarCorreo(datos.Email);
                var usuario = await _context.Usuario.FirstOrDefaultAsync(u => u.Correo == correo);

                if (usuario is null || usuario.Estado != "Activo" ||
                    !await ValidarCodigoAsync(correo, TipoRecuperacion, datos.Codigo.Trim()))
                {
                    return BadRequest(new { mensaje = MensajeCodigoInvalido });
                }

                usuario.ContrasenaHash = BCrypt.Net.BCrypt.HashPassword(datos.NuevaContrasena);
                usuario.VerificacionPendiente = false; // recibió el código en su correo: queda confirmado
                await _context.SaveChangesAsync();

                _logger.LogInformation("Contraseña restablecida para {Correo}", correo);
                return Ok(new { mensaje = "Contraseña actualizada correctamente." });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error al restablecer la contraseña");
                return StatusCode(500, new { mensaje = "No pudimos cambiar la contraseña. Inténtalo de nuevo." });
            }
        }

        // ---------------- Códigos por correo ----------------

        private async Task<IActionResult> ResponderEnvioRegistro(Usuario usuario)
        {
            var resultado = await EmitirCodigoAsync(usuario, TipoVerificacion, respetarEspera: false);
            if (resultado == ResultadoEnvio.Fallo)
            {
                return StatusCode(500, new
                {
                    mensaje = "Creamos tu cuenta, pero no pudimos enviar el correo. Intenta registrarte de nuevo en unos minutos."
                });
            }
            return Ok(new { mensaje = "Te enviamos un código de verificación a tu correo." });
        }

        private async Task<ResultadoEnvio> EmitirCodigoAsync(Usuario usuario, string tipo, bool respetarEspera)
        {
            var ahora = DateTime.UtcNow;

            var previos = await _context.CodigosVerificacion
                .Where(c => c.Correo == usuario.Correo && c.Tipo == tipo && !c.Usado)
                .ToListAsync();

            if (respetarEspera && previos.Any(c => (ahora - c.Creado).TotalSeconds < SegundosEntreEnvios))
            {
                return ResultadoEnvio.Espera;
            }

            // Solo vale el último código enviado
            foreach (var p in previos) p.Usado = true;

            var codigo = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");

            _context.CodigosVerificacion.Add(new CodigoVerificacion
            {
                Correo = usuario.Correo,
                Tipo = tipo,
                CodigoHash = HashCodigo(usuario.Correo, tipo, codigo),
                Creado = ahora,
                Expira = ahora.AddMinutes(MinutosVigenciaCodigo),
                Intentos = 0,
                Usado = false
            });
            await _context.SaveChangesAsync();

            // El envío SMTP puede tardar varios segundos (conexión + TLS + login).
            // Se hace en segundo plano para responderle al usuario de inmediato; si falla,
            // queda en el log y el usuario puede pedir "Reenviar código".
            var destino = usuario.Correo;
            var nombre = usuario.Nombre;
            var esVerificacion = tipo == TipoVerificacion;

            _ = Task.Run(async () =>
            {
                try
                {
                    using var scope = _scopeFactory.CreateScope();
                    var correo = scope.ServiceProvider.GetRequiredService<ICorreoService>();
                    await correo.EnviarCodigoAsync(destino, nombre, codigo, esVerificacion);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "No se pudo enviar el correo con el código a {Correo}", destino);
                }
            });

            return ResultadoEnvio.Enviado;
        }

        private async Task<bool> ValidarCodigoAsync(string correo, string tipo, string codigoIngresado)
        {
            var ahora = DateTime.UtcNow;

            var registro = await _context.CodigosVerificacion
                .Where(c => c.Correo == correo && c.Tipo == tipo && !c.Usado && c.Expira > ahora)
                .OrderByDescending(c => c.Creado)
                .FirstOrDefaultAsync();

            if (registro is null) return false;

            if (!CompararCodigos(registro.CodigoHash, HashCodigo(correo, tipo, codigoIngresado)))
            {
                registro.Intentos++;
                if (registro.Intentos >= MaxIntentosCodigo) registro.Usado = true; // se agotaron los intentos
                await _context.SaveChangesAsync();
                return false;
            }

            registro.Usado = true; // un código sirve una sola vez
            await _context.SaveChangesAsync();
            return true;
        }

        private string HashCodigo(string correo, string tipo, string codigo)
        {
            var clave = _configuration["Jwt:Key"] ?? throw new InvalidOperationException("Falta la configuración Jwt:Key");
            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(clave));
            return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes($"{correo}|{tipo}|{codigo}")));
        }

        // ---------------- Métodos auxiliares ----------------

        private async Task<bool> ValidarGoogleRecaptcha(string token)
        {
            if (string.IsNullOrWhiteSpace(token)) return false;

            var secretKey = _configuration["Recaptcha:SecretKey"];
            if (string.IsNullOrWhiteSpace(secretKey)) return false;

            try
            {
                using var contenido = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["secret"] = secretKey,
                    ["response"] = token
                });

                using var respuesta = await HttpGoogle.PostAsync("https://www.google.com/recaptcha/api/siteverify", contenido);
                if (!respuesta.IsSuccessStatusCode) return false;

                using var json = JsonDocument.Parse(await respuesta.Content.ReadAsStringAsync());
                var raiz = json.RootElement;

                return raiz.TryGetProperty("success", out var ok) && ok.GetBoolean();
            }
            catch
            {
                return false;
            }
        }

        private static bool VerificarPassword(string passwordPlano, string hashGuardado)
        {
            if (string.IsNullOrEmpty(hashGuardado)) return false;
            try
            {
                return BCrypt.Net.BCrypt.Verify(passwordPlano, hashGuardado);
            }
            catch (BCrypt.Net.SaltParseException)
            {
                return false;
            }
        }

        private static bool EsHashBcrypt(string? valor) =>
            !string.IsNullOrEmpty(valor) && valor.Length == 60 && valor.StartsWith("$2");

        private static bool CompararCodigos(string esperado, string recibido)
        {
            var a = Encoding.UTF8.GetBytes(esperado);
            var b = Encoding.UTF8.GetBytes(recibido);
            return CryptographicOperations.FixedTimeEquals(a, b);
        }

        private static string NormalizarCorreo(string correo) => correo.Trim().ToLowerInvariant();

        private string GenerarJwt(Usuario usuario)
        {
            var clave = _configuration["Jwt:Key"] ?? throw new InvalidOperationException("Falta la configuración Jwt:Key");

            var credenciales = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(clave)),
                SecurityAlgorithms.HmacSha256);

            var claims = new List<Claim>
            {
                new(ClaimTypes.Name, usuario.Correo),
                new(ClaimTypes.Role, usuario.Rol),
                new("role", usuario.Rol),
                new("IdUsuario", usuario.Id.ToString()),
                new("nombre", usuario.Nombre ?? string.Empty)
            };

            var token = new JwtSecurityToken(
                issuer: _configuration["Jwt:Issuer"],
                audience: _configuration["Jwt:Audience"],
                claims: claims,
                expires: DateTime.UtcNow.AddHours(2),
                signingCredentials: credenciales);

            return new JwtSecurityTokenHandler().WriteToken(token);
        }
    }

    public class LoginDto
    {
        public string Email { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
        public string RecaptchaToken { get; set; } = string.Empty;
    }

    public class VerificarCorreoDto
    {
        public string Correo { get; set; } = string.Empty;
        public string Codigo { get; set; } = string.Empty;
    }

    public class ReenviarCodigoDto
    {
        public string Correo { get; set; } = string.Empty;
    }

    public class SolicitarRecuperacionDto
    {
        public string Email { get; set; } = string.Empty;
    }

    public class RestablecerPasswordDto
    {
        public string Email { get; set; } = string.Empty;
        public string Codigo { get; set; } = string.Empty;
        public string NuevaContrasena { get; set; } = string.Empty;
    }

    public class RegistroDto
    {
        public string Nombre { get; set; } = string.Empty;
        public string Correo { get; set; } = string.Empty;
        public string ContrasenaHash { get; set; } = string.Empty;
    }
}