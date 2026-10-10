-- Built-in ringtone and caller tune per number, and a ringtone per chat (each side's own).
ALTER TABLE "personas" ADD COLUMN "ringtone" VARCHAR(20),
ADD COLUMN "callerTune" VARCHAR(20);

ALTER TABLE "conversation_members" ADD COLUMN "ringtone" VARCHAR(20);
