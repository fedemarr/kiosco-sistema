import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Writable } from 'node:stream';
import bcrypt from 'bcryptjs';
import { db } from '../src/lib/db';
import { normalizeUsername } from '../src/lib/format';
import { passwordSchema } from '../src/modules/users/service';
let muted = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!muted) stdout.write(chunk);
    callback();
  },
});
const rl = createInterface({ input: stdin, output, terminal: true });
try {
  if (!stdin.isTTY)
    throw new Error(
      'Ejecutá este comando desde una terminal interactiva para ocultar la contraseña.',
    );
  const name = (await rl.question('Nombre del dueño: ')).trim();
  const username = normalizeUsername(await rl.question('Usuario: '));
  if (name.length < 2 || !/^[a-z0-9._-]{2,50}$/.test(username))
    throw new Error('Nombre o usuario inválidos.');
  stdout.write('Contraseña (mínimo 10 caracteres, no se muestra): ');
  muted = true;
  const password = passwordSchema.parse(await rl.question(''));
  muted = false;
  stdout.write('\n');
  stdout.write('Repetir contraseña: ');
  muted = true;
  const repeat = await rl.question('');
  muted = false;
  stdout.write('\n');
  if (password !== repeat) throw new Error('Las contraseñas no coinciden.');
  if (await db.user.findFirst({ where: { username, deletedAt: null } }))
    throw new Error('El usuario ya existe.');
  const passwordHash = await bcrypt.hash(password, 12);
  await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name, username, passwordHash, role: 'OWNER', stockEnabled: true },
    });
    await tx.auditLog.create({
      data: { userId: user.id, action: 'OWNER_BOOTSTRAPPED', detail: { username } },
    });
  });
  console.info('Dueño creado. Ya podés ingresar.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'No se pudo crear el dueño.');
  process.exitCode = 1;
} finally {
  muted = false;
  rl.close();
  await db.$disconnect();
}
