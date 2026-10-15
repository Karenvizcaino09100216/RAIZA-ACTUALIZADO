namespace RAIZA.Models
{
    /// <summary>
    /// Código de 6 dígitos enviado por correo (verificar cuenta o recuperar contraseña).
    /// Nunca se guarda el código en claro: solo su hash.
    /// </summary>
    public class CodigoVerificacion
    {
        public int Id { get; set; }
        public string Correo { get; set; } = string.Empty;
        public string Tipo { get; set; } = string.Empty;        // "Verificacion" | "Recuperacion"
        public string CodigoHash { get; set; } = string.Empty;
        public DateTime Creado { get; set; }
        public DateTime Expira { get; set; }
        public int Intentos { get; set; }
        public bool Usado { get; set; }
    }
}