
function rederPage(pageKey){
    const data = pageData[pageKey];

    document.getElementById('person_page').textContent = (
        data.person_page + ' - 个人主页');
    const image = document.getElementById('image');
    image.src = data.image.src;
    image.alt = data.image.alt;
    image.style.display = 'block';
    document.getElementById('personname').textContent = data.personname;
    document.getElementById('profile_role').textContent = data.profile_role;
    document.getElementById('intro').textContent = data.intro;
    document.getElementById('interest').textContent = data.interest;
    document.getElementById('ability').textContent = data.ability;
    const skill = document.getElementById('skill_list');
    skill.innerHTML = data.skill_list.map(s => `<li>${s}</li>`).join('');
    skill.style.display = '';
}

function init(){
    const params = new URLSearchParams(window.location.search);
    const pageKey = params.get('name');
    rederPage(pageKey);
}

init();