use sha2::{digest::Output, Sha256};

pub(crate) fn sha256_hex(digest: Output<Sha256>) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(64);
    for &byte in digest.iter() {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

#[cfg(test)]
mod tests {
    use sha2::{digest::Output, Digest, Sha256};

    use super::sha256_hex;

    #[test]
    fn known_vectors_preserve_exact_lowercase_sha256() {
        for (bytes, expected) in [
            (
                b"".as_slice(),
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            ),
            (
                b"abc".as_slice(),
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            ),
            (
                b"hello world".as_slice(),
                "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
            ),
        ] {
            assert_eq!(sha256_hex(Sha256::digest(bytes)), expected);
        }
    }

    #[test]
    fn every_byte_is_encoded_as_two_lowercase_digits() {
        let mut digest = Output::<Sha256>::default();
        for byte in 0_u8..=255 {
            digest.fill(byte);
            let encoded = sha256_hex(digest);
            assert_eq!(encoded, format!("{byte:02x}").repeat(32));
            assert_eq!(encoded.len(), 64);
        }
    }
}
