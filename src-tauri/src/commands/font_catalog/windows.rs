use windows::Win32::Globalization::GetUserDefaultLocaleName;
use windows::Win32::Graphics::DirectWrite::{
    DWriteCreateFactory, IDWriteFactory, DWRITE_FACTORY_TYPE_SHARED,
};

use super::localized_name_index;

// Windows SDK LOCALE_NAME_MAX_LENGTH, including the terminating NUL.
const LOCALE_NAME_CAPACITY: usize = 85;

pub(super) fn enumerate_families() -> windows::core::Result<Vec<String>> {
    // DirectWrite interfaces are kept on this worker and released before returning.
    // Every output buffer includes the terminating UTF-16 NUL required by the API.
    unsafe {
        let factory: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?;
        let mut collection = None;
        factory.GetSystemFontCollection(&mut collection, false)?;
        let collection = collection.ok_or_else(windows::core::Error::from_thread)?;
        let mut locale = [0u16; LOCALE_NAME_CAPACITY];
        let locale_length = GetUserDefaultLocaleName(&mut locale);
        let user_locale = (locale_length > 0)
            .then(|| String::from_utf16_lossy(&locale[..locale_length as usize - 1]));
        let mut families = Vec::with_capacity(collection.GetFontFamilyCount() as usize);
        for index in 0..collection.GetFontFamilyCount() {
            let names = collection.GetFontFamily(index)?.GetFamilyNames()?;
            let mut locales = Vec::with_capacity(names.GetCount() as usize);
            for name_index in 0..names.GetCount() {
                let length = names.GetLocaleNameLength(name_index)? as usize;
                let mut buffer = vec![0u16; length + 1];
                names.GetLocaleName(name_index, &mut buffer)?;
                locales.push(String::from_utf16_lossy(&buffer[..length]));
            }
            if let Some(name_index) = localized_name_index(&locales, user_locale.as_deref()) {
                let name_index = name_index as u32;
                let length = names.GetStringLength(name_index)? as usize;
                let mut buffer = vec![0u16; length + 1];
                names.GetString(name_index, &mut buffer)?;
                families.push(String::from_utf16_lossy(&buffer[..length]));
            }
        }
        Ok(families)
    }
}
