import hashlib
import hmac
import secrets

# Crockford's Base32 Alphabet (32 symbols, 5 bits per symbol)
# Omits I, L, O (visual confusion) and U (accidental profanity)
CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CROCKFORD_MAP = {c: i for i, c in enumerate(CROCKFORD_ALPHABET)}

# CRC-16 CCITT lookup table (polynomial 0x1021)
CRC16_TABLE = []
for byte_val in range(256):
    curr = byte_val << 8
    for _ in range(8):
        if curr & 0x8000:
            curr = ((curr << 1) ^ 0x1021) & 0xFFFF
        else:
            curr = (curr << 1) & 0xFFFF
    CRC16_TABLE.append(curr)


def crc16_ccitt(data_bytes: bytes) -> int:
    """Computes standard CRC-16 CCITT (0x1021, init 0xFFFF) over byte sequence."""
    crc = 0xFFFF
    for b in data_bytes:
        crc = ((crc << 8) & 0xFFFF) ^ CRC16_TABLE[(crc >> 8) ^ b]
    return crc


def compute_checksum_10bit(payload_30chars: str) -> int:
    """Computes a 10-bit checksum integer (0..1023) over 30 normalized characters."""
    crc = crc16_ccitt(payload_30chars.encode("ascii"))
    return crc & 0x03FF


def encode_checksum_chars(checksum_10bit: int) -> str:
    """Encodes a 10-bit integer into exactly 2 Crockford Base32 characters."""
    high_5 = (checksum_10bit >> 5) & 0x1F
    low_5 = checksum_10bit & 0x1F
    return CROCKFORD_ALPHABET[high_5] + CROCKFORD_ALPHABET[low_5]


def normalize_recovery_key(raw_input: str) -> str:
    """
    Normalizes a user-supplied recovery key.
    1. Strips leading 'SF-' or 'sf-'.
    2. Strips whitespace, hyphens, and underscores.
    3. Converts to uppercase.
    4. Permissively maps O -> 0, I -> 1, L -> 1.
    5. Validates exact length (32) and Crockford alphabet.
    Raises ValueError with a generic description if invalid.
    """
    if not isinstance(raw_input, str):
        raise ValueError("Invalid recovery key format.")

    s = raw_input.strip().upper()
    # Strip formatting characters first
    s = s.replace("-", "").replace("_", "").replace(" ", "").replace("\t", "").replace("\n", "")

    # Strip prefix if present
    if s.startswith("SF"):
        s = s[2:]

    # Permissive optical substitutions
    s = s.replace("O", "0").replace("I", "1").replace("L", "1")

    if len(s) != 32:
        raise ValueError("Recovery key must be exactly 32 characters.")

    for char in s:
        if char not in CROCKFORD_MAP:
            raise ValueError(f"Invalid character in recovery key: {char}")

    return s


def verify_recovery_key_format_and_checksum(normalized_32chars: str) -> bool:
    """
    Verifies that the normalized 32-character string has a valid 10-bit checksum.
    Returns True if valid, False otherwise.
    """
    if len(normalized_32chars) != 32:
        return False

    payload = normalized_32chars[:30]
    expected_chk = normalized_32chars[30:32]
    computed_chk_val = compute_checksum_10bit(payload)
    computed_chk_chars = encode_checksum_chars(computed_chk_val)

    return hmac.compare_digest(computed_chk_chars, expected_chk)


def generate_recovery_key() -> tuple[str, str, str, str, str]:
    """
    Generates a cryptographically secure 32-character recovery key.
    Returns:
      (formatted_key, lookup_id, secret_chars, salt_hex, key_hash_hex)
    """
    # 1. Generate 30 bits for lookup_id (6 Crockford Base32 characters)
    lookup_val = secrets.randbits(30)
    lookup_id = "".join(CROCKFORD_ALPHABET[(lookup_val >> (5 * (5 - i))) & 0x1F] for i in range(6))

    # 2. Generate 120 bits for secret (15 raw bytes = 24 Crockford Base32 characters)
    secret_bytes = secrets.token_bytes(15)
    secret_int = int.from_bytes(secret_bytes, "big")
    secret_chars = "".join(CROCKFORD_ALPHABET[(secret_int >> (5 * (23 - i))) & 0x1F] for i in range(24))

    # 3. Compute 10-bit checksum over lookup_id + secret_chars (30 characters)
    payload_30 = lookup_id + secret_chars
    chk_val = compute_checksum_10bit(payload_30)
    chk_chars = encode_checksum_chars(chk_val)

    # 4. Assemble 32-character raw key
    raw_key = payload_30 + chk_chars

    # 5. Format into 8 blocks of 4 with 'SF-' prefix: SF-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
    blocks = [raw_key[i:i + 4] for i in range(0, 32, 4)]
    formatted_key = "SF-" + "-".join(blocks)

    # 6. Generate 16-byte random salt and PBKDF2-SHA256 hash (100,000 iterations)
    salt_bytes = secrets.token_bytes(16)
    salt_hex = salt_bytes.hex()
    key_hash_hex = hashlib.pbkdf2_hmac(
        "sha256",
        secret_chars.encode("utf-8"),
        salt_bytes,
        100_000,
    ).hex()

    return (formatted_key, lookup_id, secret_chars, salt_hex, key_hash_hex)


def hash_secret_key(secret_chars: str, salt_hex: str) -> str:
    """Computes PBKDF2-SHA256 hex digest for secret_chars with salt_hex."""
    return hashlib.pbkdf2_hmac(
        "sha256",
        secret_chars.encode("utf-8"),
        bytes.fromhex(salt_hex),
        100_000,
    ).hex()


def verify_secret_hash(secret_chars: str, salt_hex: str, expected_hash_hex: str) -> bool:
    """Constant-time verification of candidate secret against stored hash."""
    candidate_hash = hash_secret_key(secret_chars, salt_hex)
    return hmac.compare_digest(candidate_hash, expected_hash_hex)


def compute_dummy_hash(secret_chars: str = "DUMMY_SECRET_FOR_TIMING_DEFENSE") -> None:
    """Runs a dummy PBKDF2 computation to maintain consistent CPU timing on missing lookups."""
    hashlib.pbkdf2_hmac(
        "sha256",
        secret_chars.encode("utf-8"),
        b"stockflow_timing_defense_salt16",
        100_000,
    )
