"""Fernet envelope for small fictional captures; old keys are decrypt-only."""

from dataclasses import dataclass

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.core.config import Settings


@dataclass(frozen=True)
class CaptureCipher:
    current: Fernet
    reader: MultiFernet

    @classmethod
    def from_settings(cls, settings: Settings) -> "CaptureCipher":
        if settings.capture_encryption_key is None:
            raise ValueError("Capture encryption is disabled")
        primary = Fernet(settings.capture_encryption_key.get_secret_value().encode("ascii"))
        legacy = [
            Fernet(key.get_secret_value().encode("ascii"))
            for key in settings.capture_decryption_keys
        ]
        return cls(current=primary, reader=MultiFernet([primary, *legacy]))

    def encrypt(self, payload: bytes) -> bytes:
        return self.current.encrypt(payload)

    def decrypt(self, ciphertext: bytes) -> bytes:
        return self.reader.decrypt(ciphertext)

    def rotate_if_legacy(self, ciphertext: bytes) -> tuple[bytes, bytes | None]:
        try:
            # Current-key tokens must remain byte-for-byte unchanged.
            plaintext = self.current.decrypt(ciphertext)
            return plaintext, None
        except InvalidToken:
            # A missing legacy key aborts rotation rather than discarding data.
            plaintext = self.reader.decrypt(ciphertext)
            return plaintext, self.current.encrypt(plaintext)
