use aes_gcm::aead::{Aead as AesAead, KeyInit as AesKeyInit};
use aes_gcm::{Aes256Gcm, Nonce as AesNonce};
use anyhow::{Context, Result, bail};
use base64::Engine;
use crypto_box::{Nonce as BoxNonce, PublicKey, SalsaBox, SecretKey};
use crypto_secretbox::{Key as SecretboxKey, Nonce as SecretboxNonce, XSalsa20Poly1305};
use ed25519_dalek::{Signer, SigningKey};
use rand::{RngCore, rngs::OsRng};
use serde::Serialize;
use serde::de::DeserializeOwned;
use sha2::{Digest, Sha512};
use std::convert::TryInto;

pub fn encode_base64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

pub fn decode_base64(value: &str) -> Result<Vec<u8>> {
    base64::engine::general_purpose::STANDARD
        .decode(value)
        .context("invalid base64")
}

pub fn encode_base64_url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub fn decode_base64_url(value: &str) -> Result<Vec<u8>> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .context("invalid base64url")
}

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

pub fn data_key_encrypt(plaintext: &[u8], key: &[u8; 32]) -> Result<Vec<u8>> {
    let nonce = random_bytes::<12>();
    let cipher = Aes256Gcm::new_from_slice(key).context("invalid AES-256 key")?;
    let ciphertext = cipher
        .encrypt(AesNonce::from_slice(&nonce), plaintext)
        .map_err(|_| anyhow::anyhow!("AES-256-GCM encryption failed"))?;

    let mut result = Vec::with_capacity(1 + nonce.len() + ciphertext.len());
    result.push(0);
    result.extend_from_slice(&nonce);
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

pub fn data_key_decrypt(bundle: &[u8], key: &[u8; 32]) -> Result<Vec<u8>> {
    if bundle.len() < 1 + 12 + 16 || bundle[0] != 0 {
        bail!("unsupported or truncated data-key bundle");
    }
    let nonce: [u8; 12] = bundle[1..13].try_into().expect("nonce length checked");
    let cipher = Aes256Gcm::new_from_slice(key).context("invalid AES-256 key")?;
    cipher
        .decrypt(AesNonce::from_slice(&nonce), &bundle[13..])
        .map_err(|_| anyhow::anyhow!("AES-256-GCM authentication failed"))
}

pub fn secretbox_encrypt(plaintext: &[u8], key: &[u8; 32]) -> Result<Vec<u8>> {
    let nonce = random_bytes::<24>();
    let cipher = XSalsa20Poly1305::new(SecretboxKey::from_slice(key));
    let ciphertext = cipher
        .encrypt(SecretboxNonce::from_slice(&nonce), plaintext)
        .map_err(|_| anyhow::anyhow!("XSalsa20-Poly1305 encryption failed"))?;
    let mut result = Vec::with_capacity(nonce.len() + ciphertext.len());
    result.extend_from_slice(&nonce);
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

pub fn secretbox_decrypt(bundle: &[u8], key: &[u8; 32]) -> Result<Vec<u8>> {
    if bundle.len() < 24 + 16 {
        bail!("truncated secretbox bundle");
    }
    let cipher = XSalsa20Poly1305::new(SecretboxKey::from_slice(key));
    cipher
        .decrypt(SecretboxNonce::from_slice(&bundle[..24]), &bundle[24..])
        .map_err(|_| anyhow::anyhow!("XSalsa20-Poly1305 authentication failed"))
}

pub fn encrypt_json<T: Serialize>(value: &T, key: &[u8; 32]) -> Result<Vec<u8>> {
    data_key_encrypt(&serde_json::to_vec(value)?, key)
}

pub fn decrypt_json<T: DeserializeOwned>(bundle: &[u8], key: &[u8; 32]) -> Result<T> {
    let plaintext = data_key_decrypt(bundle, key)?;
    serde_json::from_slice(&plaintext).context("decrypted payload is not valid JSON")
}

pub fn public_key_from_seed(seed: &[u8; 32]) -> [u8; 32] {
    let digest = Sha512::digest(seed);
    let secret: [u8; 32] = digest[..32]
        .try_into()
        .expect("SHA-512 digest is long enough");
    SecretKey::from(secret).public_key().to_bytes()
}

pub fn box_public_key_from_secret(secret: &[u8; 32]) -> [u8; 32] {
    SecretKey::from(*secret).public_key().to_bytes()
}

pub fn encrypt_for_public_key(data: &[u8], recipient_public_key: &[u8; 32]) -> Result<Vec<u8>> {
    let ephemeral = SecretKey::generate(&mut OsRng);
    let recipient = PublicKey::from(*recipient_public_key);
    let nonce = random_bytes::<24>();
    let cipher = SalsaBox::new(&recipient, &ephemeral);
    let encrypted = cipher
        .encrypt(BoxNonce::from_slice(&nonce), data)
        .map_err(|_| anyhow::anyhow!("public-key encryption failed"))?;

    let mut result = Vec::with_capacity(32 + 24 + encrypted.len());
    result.extend_from_slice(&ephemeral.public_key().to_bytes());
    result.extend_from_slice(&nonce);
    result.extend_from_slice(&encrypted);
    Ok(result)
}

pub fn decrypt_with_secret_key(bundle: &[u8], recipient_secret_key: &[u8; 32]) -> Result<Vec<u8>> {
    if bundle.len() < 32 + 24 + 16 {
        bail!("truncated public-key bundle");
    }
    let ephemeral_public: [u8; 32] = bundle[..32].try_into().expect("public key length checked");
    let nonce: [u8; 24] = bundle[32..56].try_into().expect("nonce length checked");
    let recipient = SecretKey::from(*recipient_secret_key);
    let cipher = SalsaBox::new(&PublicKey::from(ephemeral_public), &recipient);
    cipher
        .decrypt(BoxNonce::from_slice(&nonce), &bundle[56..])
        .map_err(|_| anyhow::anyhow!("public-key authentication failed"))
}

pub fn auth_signature(seed: &[u8; 32], challenge: &[u8]) -> ([u8; 32], Vec<u8>) {
    let signing_key = SigningKey::from_bytes(seed);
    let signature = signing_key.sign(challenge);
    (
        signing_key.verifying_key().to_bytes(),
        signature.to_bytes().to_vec(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    use serde_json::json;

    #[test]
    fn data_key_bundle_round_trips_json() {
        let key = [7_u8; 32];
        let input = json!({ "hello": "happy", "n": 42 });
        let bundle = encrypt_json(&input, &key).unwrap();
        assert_eq!(bundle[0], 0);
        let output: serde_json::Value = decrypt_json(&bundle, &key).unwrap();
        assert_eq!(output, input);
    }

    #[test]
    fn secretbox_bundle_round_trips_binary() {
        let key = [9_u8; 32];
        let input = [0_u8, 1, 2, 0xff, 42];
        let bundle = secretbox_encrypt(&input, &key).unwrap();
        assert_eq!(secretbox_decrypt(&bundle, &key).unwrap(), input);
    }

    #[test]
    fn public_key_bundle_round_trips() {
        let recipient_secret = [11_u8; 32];
        let recipient_public = box_public_key_from_secret(&recipient_secret);
        let bundle = encrypt_for_public_key(b"hello", &recipient_public).unwrap();
        assert_eq!(
            decrypt_with_secret_key(&bundle, &recipient_secret).unwrap(),
            b"hello"
        );
    }

    #[test]
    fn auth_signature_is_ed25519_verifiable() {
        let seed = [13_u8; 32];
        let challenge = b"challenge";
        let (public_key, signature) = auth_signature(&seed, challenge);
        let key = VerifyingKey::from_bytes(&public_key).unwrap();
        key.verify(challenge, &Signature::from_slice(&signature).unwrap())
            .unwrap();
    }

    #[test]
    fn decrypts_typescript_aes_data_key_fixture() {
        let bundle = decode_base64(
            "AAECAwQFBgcICQoLDH7IMrCA+J+kdoALJmBjkwpuYY/crVliuIpUNAmex25/tRo5rP85bKo=",
        )
        .unwrap();
        let key: [u8; 32] = (0_u8..32).collect::<Vec<_>>().try_into().unwrap();
        let value: serde_json::Value = decrypt_json(&bundle, &key).unwrap();
        assert_eq!(value, serde_json::json!({ "hello": "happy", "n": 42 }));
    }

    #[test]
    fn decrypts_typescript_secretbox_fixture() {
        let bundle =
            decode_base64("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYvxOqrIeeeUqqUo0UaV3CQ7XALQtN").unwrap();
        let key: [u8; 32] = (11_u8..43).collect::<Vec<_>>().try_into().unwrap();
        assert_eq!(secretbox_decrypt(&bundle, &key).unwrap(), b"hello");
    }

    #[test]
    fn decrypts_typescript_box_fixture() {
        let bundle = decode_base64(
            "WGmv9FBUlzLLqu1eXfmzCm2jHLDldCutWtShp2jxpnszNDU2Nzg5Ojs8PT4/QEFCQ0RFRkdISUoRz7vRGmhnoIRxjqdUhOb+14a736vZdl8=",
        )
        .unwrap();
        let key: [u8; 32] = (11_u8..43).collect::<Vec<_>>().try_into().unwrap();
        assert_eq!(decrypt_with_secret_key(&bundle, &key).unwrap(), b"data-key");
    }

    #[test]
    fn public_key_matches_tweetnacl_fixture() {
        let key: [u8; 32] = (11_u8..43).collect::<Vec<_>>().try_into().unwrap();
        assert_eq!(
            encode_base64(&box_public_key_from_secret(&key)),
            "40/dm+KAxRwa8pQJbdsGFVfkIeTjAukxn4b+2FqZ4FM="
        );
    }
}
