# Certificado público de Supabase

`supabase-ca.crt` es la CA pública de Supabase Root 2021, descargada por HTTPS desde:
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

No es una clave privada ni un secreto. SHA-256:
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`

El backend verifica la cadena y el hostname. No se usa rejectUnauthorized:false. Antes del vencimiento (26/04/2031), renovar desde el panel oficial Database Settings → SSL Configuration.
