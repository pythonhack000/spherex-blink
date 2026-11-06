// Interface text in English and Russian.
const TEXT = {
  en: {
    heroTitle: 'What moved?',
    heroSub: 'Pluto was found by flipping between two photographs. Do the same across the whole infrared sky with NASA SPHEREx: pick a target, or zoom the map and click anywhere.',
    hook_barnard: '10.4″ a year, the fastest star in the sky',
    hook_wise0855: '8.1″ a year, about as cold as Earth’s poles',
    hook_epsindib: '4.7″ a year, a pair of brown dwarfs',
    hook_rwaur: 'A young star that changes unpredictably',
    hook_rdra: 'A pulsating giant with a 245-day cycle',
    tagline: 'Compare the infrared sky across dates and see what moved.',
    searchLabel: 'Coordinates or object name',
    searchPlaceholder: '08h55m10.8s -7d14m42s, 133.79 -7.24, or a name',
    open: 'Open',
    tour: 'Play demo',
    stopTour: 'Stop demo',
    allSky: 'All sky',
    openHere: 'Open this patch',
    skyHint: 'Drag and zoom the sky, then click a spot, or pick a target above.',
    skyCredit: 'Background map: AllWISE. SPHEREx frames load when you open a patch.',
    fieldOfView: 'Field of view',
    modeVideo: 'Video',
    modeSum: 'Sum',
    modeDiff: 'Difference',
    play: 'Play',
    pause: 'Pause',
    allDates: 'All dates',
    composite: 'All bands',
    bandSlider: 'Infrared band',
    gaia: 'Gaia stars',
    wise: 'AllWISE 2010',
    excludeFlags: 'Exclude flagged pixels',
    flagged: '{pct}% of pixels flagged',
    frames: '{count} frames',
    noFrames: 'No frames in this band for this date. Choose All dates or a nearby band.',
    searching: 'Searching the SPHEREx archive.',
    downloading: 'Downloaded {done} of {total} exposures. The picture sharpens as they arrive.',
    subset: 'Using {total} of {available} exposures, spread evenly over time.',
    noCoverage: 'SPHEREx has no released images of this position yet. Try another position.',
    failedFrames: '{count} exposures could not be read.',
    spectrum: 'Spectrum',
    lightCurve: 'Light curve',
    clickHint: 'Click anywhere on the plate to build a spectrum of that spot.',
    building: 'Building the spectrum from every exposure.',
    noSpectrum: 'No usable measurement at this spot. Try a position nearer the centre.',
    wavelength: 'Wavelength, μm',
    date: 'Date',
    flux: 'Flux, μJy',
    flaggedNote: 'Hollow points have flagged pixels, often saturation, so their flux is unreliable. Aperture 7″, no aperture correction; close neighbours add light.',
    measure: 'Measure motion',
    measuring: 'Tracking the source between dates.',
    measured: 'Measured',
    catalogue: 'Catalogue',
    controls: 'Field stars, same method',
    perYear: '″/yr',
    motionBaseline: '{count} dates, arrays {detectors}.',
    motionVerdict: 'The source moves far more than field stars do, so the motion is real.',
    motionWeak: 'The motion is not clearly larger than the field-star scatter, so this is not a detection.',
    wiseFailed: 'AllWISE is unavailable right now.',
    gaiaFailed: 'Gaia is unavailable right now.',
    notFound: 'Nothing found. Enter coordinates such as 269.45 4.77.',
    kindstar: 'Fastest-moving star in the sky',
    kindbrowndwarf: 'Brown dwarf',
    kindvariable: 'Variable star',
    kindcustom: 'Custom position',
    expected: 'Ring: where the catalogue motion predicts the object on this date.',
    differenceLegend: 'Amber: brighter than the first date. Blue: fainter.',
    captionSky: 'SPHEREx maps the whole sky every six months in 102 infrared bands. Pick any patch by zooming or typing coordinates.',
    captionBarnard: 'Barnard’s Star, six light-years away. Frames from different dates play as a video, and the star moves with the ring predicted by Gaia.',
    captionBands: 'Now sweep through the 102 bands, from 0.75 to 5 μm. Each one shows different light.',
    captionSpectrum: 'Click the star, and its spectrum is measured right now from every exposure.',
    captionWise: 'WISE 0855: one of the coldest known brown dwarfs, 7.4 light-years away. On the plate it is the red spot beside a star that stays put.',
    captionWiseMotion: 'It shifts between dates. We measure that motion and test the method on field stars, which should barely move.',
    captionWise2010: 'Add AllWISE from 2010. In sixteen years the brown dwarf has crossed about two arcminutes of sky.',
    captionEnd: 'Anyone can do this for any patch of sky. New SPHEREx releases appear here automatically.',
    credit: 'Data: NASA SPHEREx, AllWISE and ESA Gaia DR3, served by NASA/IPAC IRSA. Colours are false colour.',
  },
  ru: {
    heroTitle: 'Что сдвинулось?',
    heroSub: 'Плутон нашли, переключаясь между двумя снимками. Сделайте то же самое на всём инфракрасном небе с NASA SPHEREx: выберите цель или приблизьте карту и нажмите на любую точку.',
    hook_barnard: '10,4″ в год, самая быстрая звезда на небе',
    hook_wise0855: '8,1″ в год, холодный как полюса Земли',
    hook_epsindib: '4,7″ в год, пара коричневых карликов',
    hook_rwaur: 'Молодая звезда с непредсказуемым блеском',
    hook_rdra: 'Пульсирующий гигант с циклом 245 дней',
    tagline: 'Сравните инфракрасное небо за разные даты и увидьте, что сдвинулось.',
    searchLabel: 'Координаты или название объекта',
    searchPlaceholder: '08h55m10.8s -7d14m42s, 133.79 -7.24 или название',
    open: 'Открыть',
    tour: 'Запустить демо',
    stopTour: 'Остановить демо',
    allSky: 'Всё небо',
    openHere: 'Открыть этот участок',
    skyHint: 'Двигайте и приближайте небо, затем нажмите на точку или выберите цель вверху.',
    skyCredit: 'Фон карты: AllWISE. Снимки SPHEREx загружаются при открытии участка.',
    fieldOfView: 'Поле зрения',
    modeVideo: 'Видео',
    modeSum: 'Сумма',
    modeDiff: 'Разность',
    play: 'Пуск',
    pause: 'Пауза',
    allDates: 'Все даты',
    composite: 'Все полосы',
    bandSlider: 'Инфракрасная полоса',
    gaia: 'Звёзды Gaia',
    wise: 'AllWISE 2010',
    excludeFlags: 'Исключить помеченные пиксели',
    flagged: 'Помечено пикселей: {pct}%',
    frames: 'Кадров: {count}',
    noFrames: 'В этой полосе на эту дату кадров нет. Выберите «Все даты» или соседнюю полосу.',
    searching: 'Ищу снимки в архиве SPHEREx.',
    downloading: 'Загружено {done} из {total} кадров. По мере загрузки картинка становится чётче.',
    subset: 'Используется {total} из {available} кадров, равномерно по времени.',
    noCoverage: 'Для этой точки SPHEREx ещё не выпустил снимков. Попробуйте другую.',
    failedFrames: 'Не удалось прочитать кадров: {count}.',
    spectrum: 'Спектр',
    lightCurve: 'Кривая блеска',
    clickHint: 'Нажмите на любую точку снимка, чтобы построить её спектр.',
    building: 'Строю спектр по всем кадрам.',
    noSpectrum: 'В этой точке нет пригодных измерений. Выберите точку ближе к центру.',
    wavelength: 'Длина волны, мкм',
    date: 'Дата',
    flux: 'Поток, мкЯн',
    flaggedNote: 'Пустые точки содержат помеченные пиксели, часто это насыщение, и их поток ненадёжен. Апертура 7″, без апертурной поправки; близкие соседи добавляют свет.',
    measure: 'Измерить движение',
    measuring: 'Отслеживаю источник между датами.',
    measured: 'Измерено',
    catalogue: 'Каталог',
    controls: 'Звёзды поля, тот же метод',
    perYear: '″/год',
    motionBaseline: 'Дат: {count}, матрицы: {detectors}.',
    motionVerdict: 'Источник смещается намного сильнее звёзд поля, значит движение настоящее.',
    motionWeak: 'Движение не превышает заметно разброс у звёзд поля, поэтому это не обнаружение.',
    wiseFailed: 'AllWISE сейчас недоступен.',
    gaiaFailed: 'Gaia сейчас недоступна.',
    notFound: 'Ничего не найдено. Введите координаты, например 269.45 4.77.',
    kindstar: 'Самая быстрая звезда на небе',
    kindbrowndwarf: 'Коричневый карлик',
    kindvariable: 'Переменная звезда',
    kindcustom: 'Произвольная точка',
    expected: 'Кольцо: где объект должен быть на эту дату по данным каталога.',
    differenceLegend: 'Янтарный: ярче, чем на первую дату. Синий: слабее.',
    captionSky: 'SPHEREx снимает всё небо каждые полгода в 102 инфракрасных полосах. Выберите любой участок: приблизьте его или введите координаты.',
    captionBarnard: 'Звезда Барнарда, шесть световых лет от нас. Снимки разных дат складываются в видео, и звезда движется вместе с кольцом, предсказанным Gaia.',
    captionBands: 'Теперь пройдём по 102 полосам, от 0,75 до 5 мкм. В каждой виден свой свет.',
    captionSpectrum: 'Нажимаем на звезду, и её спектр измеряется прямо сейчас по всем кадрам.',
    captionWise: 'WISE 0855: один из самых холодных известных коричневых карликов, 7,4 светового года от нас. На снимке это красное пятно рядом с неподвижной звездой.',
    captionWiseMotion: 'Между датами он смещается. Измеряем это движение и проверяем метод на звёздах поля: они почти не должны двигаться.',
    captionWise2010: 'Добавим снимок AllWISE 2010 года. За шестнадцать лет карлик прошёл по небу около двух угловых минут.',
    captionEnd: 'Так можно изучить любой участок неба. Новые релизы SPHEREx появляются здесь автоматически.',
    credit: 'Данные: NASA SPHEREx, AllWISE и ESA Gaia DR3 через NASA/IPAC IRSA. Цвета условные.',
  },
};

function storedLanguage() {
  try {
    return localStorage.getItem('blink-language');
  } catch {
    return null;
  }
}

let language = storedLanguage() ?? (navigator.language?.startsWith('ru') ? 'ru' : 'en');

export function currentLanguage() {
  return language;
}

export function setLanguage(next) {
  language = next;
  document.documentElement.lang = next;
  try {
    localStorage.setItem('blink-language', next);
  } catch {
    // Without storage the choice simply lasts for this visit.
  }
}

export function t(key, values = {}) {
  const template = TEXT[language][key] ?? TEXT.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '');
}

export function applyTranslations(root = document) {
  for (const node of root.querySelectorAll('[data-t]')) node.textContent = t(node.dataset.t);
  for (const node of root.querySelectorAll('[data-t-placeholder]')) node.placeholder = t(node.dataset.tPlaceholder);
  for (const node of root.querySelectorAll('[data-t-label]')) node.setAttribute('aria-label', t(node.dataset.tLabel));
}
